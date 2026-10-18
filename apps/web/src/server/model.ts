import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireOpportunity, requireSpending, type Actor } from "./access";
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { database, orm } from "./db";
import {
  inferenceAttempts,
  inferenceBudgets,
  inferenceDenials,
  inferenceModels,
  inferenceOperations,
} from "./db-schema";
import { AppError } from "./errors";

const requestSchema = z
  .object({
    key: z.string().min(1).max(200),
    attempt: z.number().int().min(1).max(5).default(1),
    opportunityId: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    input: z.string().max(10485760),
    photos: z.array(z.string().max(10485760)).max(20),
  })
  .strict();
const integer = z.number().int().nonnegative().safe();
const usageSchema = z.object({
  modelVersion: z.string().min(1).max(200),
  inputTokens: integer.max(100000000),
  outputTokens: integer.max(100000000),
  reviewOutcome: z.enum(["needs_review", "validated", "rejected"]),
});
const reportSchema = z.discriminatedUnion("kind", [
  usageSchema
    .extend({
      kind: z.literal("completed"),
      output: z.string().max(1000000),
    })
    .strict(),
  usageSchema.extend({ kind: z.literal("failed"), retryable: z.boolean() }).strict(),
  z.object({ kind: z.literal("not-billed"), retryable: z.boolean() }).strict(),
]);
const policySchema = z.object({
  max_input_bytes: integer,
  max_photos: integer,
  photo_tokens: integer,
  overhead_tokens: integer,
  max_output_tokens: integer,
  input_micro_usd: integer,
  output_micro_usd: integer,
  rate_tokens: integer.min(1).max(1000000),
  max_attempts: integer,
  retry_ms: integer,
  timeout_ms: integer,
});
type Request = z.infer<typeof requestSchema>;
type Report = z.infer<typeof reportSchema>;
export type Provider = (request: {
  model: string;
  input: string;
  photos: string[];
  maxInputTokens: number;
  maxOutputTokens: number;
  // Reserved micro-USD per token, which equals the US$ per million tokens a provider may charge.
  inputMicroUsd: number;
  outputMicroUsd: number;
  attemptId: string;
  signal: AbortSignal;
  timeout: number;
}) => Promise<Report>;
type Admission =
  | { kind: "cached"; report: Report }
  | {
      kind: "dispatch";
      attemptId: string;
      maxInputTokens: number;
      maxOutputTokens: number;
      inputMicroUsd: number;
      outputMicroUsd: number;
      timeoutMs: number;
    };

async function transaction<T>(client: PoolClient, action: () => Promise<T>) {
  await orm(client).execute(sql`begin`);
  try {
    await orm(client).execute(sql`set local lock_timeout='5s'`);
    const result = await action();
    await orm(client).execute(sql`commit`);
    return result;
  } catch (error) {
    await orm(client).execute(sql`rollback`);
    throw error;
  }
}

async function currentAccess(actor: Actor, request: Request, db: PoolClient) {
  await orm(db).execute(sql`select signal_desk.lock_inference_access()`);
  await requireSpending(actor, db);
  await requireOpportunity(actor, request.opportunityId, undefined, db);
}

async function operation(
  actor: Actor,
  request: Request,
  policy: z.infer<typeof policySchema>,
  db: PoolClient,
) {
  const { attempt: _attempt, ...payload } = request;
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  await orm(db).execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${actor.userId + ":" + request.key},74002))`,
  );
  await orm(db)
    .insert(inferenceOperations)
    .values({
      id: randomUUID(),
      user_id: actor.userId,
      request_key: request.key,
      opportunity_id: request.opportunityId,
      fingerprint,
      model_id: request.model,
      max_attempts: policy.max_attempts,
    })
    .onConflictDoNothing({
      target: [inferenceOperations.user_id, inferenceOperations.request_key],
    });
  const result = await orm(db)
    .select({
      id: inferenceOperations.id,
      fingerprint: inferenceOperations.fingerprint,
      max_attempts: inferenceOperations.max_attempts,
    })
    .from(inferenceOperations)
    .where(
      and(
        eq(inferenceOperations.user_id, actor.userId),
        eq(inferenceOperations.request_key, request.key),
      ),
    );
  const row = z
    .object({ id: z.uuid(), fingerprint: z.string(), max_attempts: integer })
    .parse(result[0]);
  if (row.fingerprint !== fingerprint)
    throw new AppError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Request key was already used for different input.",
    );
  return row;
}

function knownReport(report: Report | null) {
  if (!report)
    throw new AppError(
      409,
      "SPEND_UNCERTAIN",
      "An attempt may still be billed. Reconciliation is required.",
    );
  return report;
}

function requireRetry(previous: Report | null, wait: boolean) {
  const report = knownReport(previous);
  if (report.kind === "completed" || !report.retryable)
    throw new AppError(409, "ATTEMPTS_EXHAUSTED", "No more attempts are permitted.");
  if (wait) throw new AppError(429, "RETRY_LATER", "Wait before retrying this operation.");
}

async function priorAttempt(
  operationId: string,
  maxAttempts: number,
  requested: number,
  db: PoolClient,
) {
  const result = await orm(db)
    .select({
      number: inferenceAttempts.number,
      report: inferenceAttempts.report,
      wait: sql<boolean>`${inferenceAttempts.retry_after} > clock_timestamp()`,
    })
    .from(inferenceAttempts)
    .where(eq(inferenceAttempts.operation_id, operationId))
    .orderBy(desc(inferenceAttempts.number));
  const rows = z
    .array(z.object({ number: integer, report: reportSchema.nullable(), wait: z.boolean() }))
    .parse(result);
  const existing = rows.find((row) => row.number === requested);
  if (existing) return { ...existing, report: knownReport(existing.report) };
  if (requested > maxAttempts)
    throw new AppError(409, "ATTEMPTS_EXHAUSTED", "No more attempts are permitted.");
  const row = rows[0];
  if (requested !== (row?.number ?? 0) + 1)
    throw new AppError(409, "ATTEMPT_CONFLICT", "Attempts must be requested in order.");
  if (!row) return { number: 0, report: null };
  requireRetry(row.report, row.wait);
  return { number: row.number, report: null };
}

async function reserve(userId: string, amount: number, db: PoolClient) {
  const result = await orm(db)
    .select({
      scope: inferenceBudgets.scope,
      exhausted: sql<boolean>`${inferenceBudgets.spent_micro_usd}+${inferenceBudgets.reserved_micro_usd}+${amount} > ${inferenceBudgets.limit_micro_usd}`,
      busy: sql<boolean>`${inferenceBudgets.active} >= ${inferenceBudgets.max_concurrent}`,
    })
    .from(inferenceBudgets)
    .where(inArray(inferenceBudgets.scope, ["installation", userId]))
    .orderBy(inferenceBudgets.scope)
    .for("update");
  const rows = z
    .array(z.object({ scope: z.string(), exhausted: z.boolean(), busy: z.boolean() }))
    .parse(result);
  if (rows.length !== 2 || rows.some((row) => row.exhausted))
    throw new AppError(429, "BUDGET_EXHAUSTED", "Inference budget is unavailable or exhausted.");
  if (rows.some((row) => row.busy))
    throw new AppError(429, "CONCURRENCY_LIMIT", "Inference concurrency limit reached.");
  await orm(db)
    .update(inferenceBudgets)
    .set({
      reserved_micro_usd: sql`${inferenceBudgets.reserved_micro_usd}+${amount}`,
      active: sql`${inferenceBudgets.active}+1`,
    })
    .where(inArray(inferenceBudgets.scope, ["installation", userId]));
}

async function admit(actor: Actor, request: Request, db: PoolClient): Promise<Admission> {
  await currentAccess(actor, request, db);
  const config = await orm(db)
    .select()
    .from(inferenceModels)
    .where(and(eq(inferenceModels.id, request.model), eq(inferenceModels.enabled, true)));
  if (!config.length) throw new AppError(503, "NOT_CONFIGURED", "Model is not configured.");
  const policy = policySchema.parse(config[0]);
  const bytes =
    Buffer.byteLength(request.input) +
    request.photos.reduce((sum, photo) => sum + Buffer.byteLength(photo), 0);
  if (bytes > policy.max_input_bytes || request.photos.length > policy.max_photos)
    throw new AppError(413, "INPUT_TOO_LARGE", "Inference input exceeds configured limits.");
  const op = await operation(actor, request, policy, db);
  const prior = await priorAttempt(
    op.id,
    Math.min(op.max_attempts, policy.max_attempts),
    request.attempt,
    db,
  );
  if (prior.report) return { kind: "cached", report: prior.report };
  const inputBound = bytes + request.photos.length * policy.photo_tokens + policy.overhead_tokens;
  const amount = Math.ceil(
    (inputBound * policy.input_micro_usd + policy.max_output_tokens * policy.output_micro_usd) /
      policy.rate_tokens,
  );
  await reserve(actor.userId, amount, db);
  await currentAccess(actor, request, db);
  const attemptId = randomUUID();
  await orm(db)
    .insert(inferenceAttempts)
    .values({
      id: attemptId,
      operation_id: op.id,
      number: prior.number + 1,
      state: "dispatched",
      reserved_micro_usd: String(amount),
      input_rate: policy.input_micro_usd,
      output_rate: policy.output_micro_usd,
      rate_tokens: policy.rate_tokens,
      input_bound: inputBound,
      output_bound: policy.max_output_tokens,
      retry_ms: policy.retry_ms,
      retry_after: sql`clock_timestamp()+${policy.retry_ms}::integer*interval '1 millisecond'`,
    });
  return {
    kind: "dispatch",
    attemptId,
    maxInputTokens: inputBound,
    maxOutputTokens: policy.max_output_tokens,
    inputMicroUsd: policy.input_micro_usd,
    outputMicroUsd: policy.output_micro_usd,
    timeoutMs: policy.timeout_ms,
  };
}

async function settle(attemptId: string, report: Report, evidence: string | null, db: PoolClient) {
  const attempt = alias(inferenceAttempts, "attempt");
  const result = await orm(db)
    .select({ ...getTableColumns(attempt), user_id: inferenceOperations.user_id })
    .from(attempt)
    .innerJoin(inferenceOperations, eq(inferenceOperations.id, attempt.operation_id))
    .where(eq(attempt.id, attemptId))
    .for("update", { of: attempt });
  if (!result.length) throw new AppError(404, "NOT_FOUND", "Inference attempt not found.");
  const row = z
    .object({
      state: z.string(),
      report: reportSchema.nullable(),
      user_id: z.uuid(),
      reserved_micro_usd: z.coerce.number(),
      input_rate: integer,
      output_rate: integer,
      rate_tokens: integer.min(1).max(1000000),
      input_bound: integer,
      output_bound: integer,
    })
    .parse(result[0]);
  if (row.report) {
    if (JSON.stringify(row.report) !== JSON.stringify(report))
      throw new AppError(409, "SETTLEMENT_CONFLICT", "Attempt was already settled differently.");
    return;
  }
  if (
    !evidence &&
    report.kind !== "not-billed" &&
    (report.inputTokens > row.input_bound || report.outputTokens > row.output_bound)
  )
    throw new AppError(409, "SPEND_UNCERTAIN", "Provider usage exceeded the reserved bounds.");
  const charge =
    report.kind !== "not-billed"
      ? Math.ceil(
          (report.inputTokens * row.input_rate + report.outputTokens * row.output_rate) /
            row.rate_tokens,
        )
      : 0;
  // Lock both scopes in the same order as admission.
  await orm(db)
    .select({ scope: inferenceBudgets.scope })
    .from(inferenceBudgets)
    .where(inArray(inferenceBudgets.scope, ["installation", row.user_id]))
    .orderBy(inferenceBudgets.scope)
    .for("update");
  await orm(db)
    .update(inferenceBudgets)
    .set({
      reserved_micro_usd: sql`${inferenceBudgets.reserved_micro_usd}-${row.reserved_micro_usd}`,
      spent_micro_usd: sql`${inferenceBudgets.spent_micro_usd}+${charge}`,
      active: sql`${inferenceBudgets.active}-1`,
    })
    .where(inArray(inferenceBudgets.scope, ["installation", row.user_id]));
  await orm(db)
    .update(inferenceAttempts)
    .set({
      state: report.kind,
      report,
      finished_at: sql`clock_timestamp()`,
      duration_ms: sql`least(2147483647,extract(epoch from (clock_timestamp()-${inferenceAttempts.started_at}))*1000)::integer`,
      retry_after: sql`clock_timestamp()+${inferenceAttempts.retry_ms}*interval '1 millisecond'`,
      reconciliation_evidence: evidence,
    })
    .where(eq(inferenceAttempts.id, attemptId));
}

function outcome(report: Report) {
  if (report.kind !== "completed")
    throw new AppError(
      report.retryable ? 503 : 422,
      "PROVIDER_FAILED",
      "Provider did not complete the attempt.",
    );
  return report;
}

/** Runs one paid attempt behind fresh access, shared budgets, and durable idempotency.
 * Provider adapters are server-owned, must disable SDK retries, and honor token bounds.
 * Input must already contain only evidence permitted for this actor and opportunity.
 * @throws {AppError} For denial, unavailable configuration, retry bounds, or uncertain spend.
 */
export async function runInference(actor: Actor, raw: unknown, provider?: Provider) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(422, "INVALID_INPUT", "Invalid inference request.");
  if (!provider) throw new AppError(503, "NOT_CONFIGURED", "Inference provider is unavailable.");
  const request = parsed.data;
  const db = await database().connect();
  let admission: Admission;
  try {
    admission = await transaction(db, () => admit(actor, request, db));
  } catch (error) {
    if (error instanceof AppError) {
      const userId = z.uuid().safeParse(actor.userId);
      await orm(db)
        .insert(inferenceDenials)
        .values({
          id: randomUUID(),
          user_id: userId.success ? userId.data : null,
          code: error.code,
        });
    }
    throw error;
  } finally {
    db.release();
  }
  if (admission.kind === "cached") return outcome(admission.report);
  const { attemptId, maxInputTokens, maxOutputTokens, inputMicroUsd, outputMicroUsd, timeoutMs } =
    admission;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let report: Report;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    report = reportSchema.parse(
      await Promise.race([
        provider({
          model: request.model,
          input: request.input,
          photos: request.photos,
          maxInputTokens,
          maxOutputTokens,
          inputMicroUsd,
          outputMicroUsd,
          attemptId,
          signal: controller.signal,
          timeout: timeoutMs,
        }),
        timeout,
      ]),
    );
    const client = await database().connect();
    try {
      await transaction(client, () => settle(attemptId, report, null, client));
    } finally {
      client.release();
    }
  } catch {
    await orm()
      .update(inferenceAttempts)
      .set({ state: "uncertain" })
      .where(and(eq(inferenceAttempts.id, attemptId), eq(inferenceAttempts.state, "dispatched")));
    throw new AppError(
      409,
      "SPEND_UNCERTAIN",
      "Attempt outcome is uncertain. Reservation retained.",
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  await requireOpportunity(actor, request.opportunityId);
  return outcome(report);
}

/** Reconciles a lost response using a verified provider receipt or confirmed non-billing.
 * Requires an idle operator connection; runtime connections cannot reconcile reservations.
 * @throws {AppError} For insufficient privilege, conflicting settlement, or invalid usage.
 */
export async function reconcileInference(
  attemptId: string,
  raw: unknown,
  evidence: string,
  db: PoolClient,
) {
  const permitted = await orm(db).execute<{ allowed: boolean }>(
    sql`select has_table_privilege(current_user,'signal_desk.inference_models','UPDATE') as allowed`,
  );
  if (!permitted.rows[0]?.allowed)
    throw new AppError(403, "FORBIDDEN", "Operator reconciliation is required.");
  if (!evidence.trim() || evidence.length > 500)
    throw new AppError(422, "INVALID_INPUT", "Receipt reference is required.");
  const report = reportSchema.safeParse(raw);
  const id = z.uuid().safeParse(attemptId);
  if (!report.success || !id.success)
    throw new AppError(422, "INVALID_INPUT", "Invalid reconciliation report.");
  await transaction(db, () => settle(id.data, report.data, evidence, db));
}
