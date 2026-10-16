import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireOpportunity, requireSpending, type Actor } from "./access";
import { database } from "./db";
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
  max_attempts: integer,
  retry_ms: integer,
  timeout_ms: integer,
});
type Request = z.infer<typeof requestSchema>;
type Report = z.infer<typeof reportSchema>;
type Provider = (request: {
  model: string;
  input: string;
  photos: string[];
  maxInputTokens: number;
  maxOutputTokens: number;
  attemptId: string;
  signal: AbortSignal;
}) => Promise<Report>;
type Admission =
  | { kind: "cached"; report: Report }
  | {
      kind: "dispatch";
      attemptId: string;
      maxInputTokens: number;
      maxOutputTokens: number;
      timeoutMs: number;
    };

async function transaction<T>(client: PoolClient, action: () => Promise<T>) {
  await client.query("begin");
  try {
    await client.query("set local lock_timeout='5s'");
    const result = await action();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function currentAccess(actor: Actor, request: Request, db: PoolClient) {
  await db.query("select signal_desk.lock_inference_access()");
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
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,74002))", [
    actor.userId + ":" + request.key,
  ]);
  await db.query(
    `insert into signal_desk.inference_operations
    (id,user_id,request_key,opportunity_id,fingerprint,model_id,max_attempts)
    values ($1,$2,$3,$4,$5,$6,$7) on conflict(user_id,request_key) do nothing`,
    [
      randomUUID(),
      actor.userId,
      request.key,
      request.opportunityId,
      fingerprint,
      request.model,
      policy.max_attempts,
    ],
  );
  const result = await db.query(
    `select id,fingerprint,max_attempts from signal_desk.inference_operations
    where user_id=$1 and request_key=$2`,
    [actor.userId, request.key],
  );
  const row = z
    .object({ id: z.uuid(), fingerprint: z.string(), max_attempts: integer })
    .parse(result.rows[0]);
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
  const result = await db.query(
    `select number,report,retry_after > clock_timestamp() as wait
    from signal_desk.inference_attempts where operation_id=$1 order by number desc`,
    [operationId],
  );
  const rows = z
    .array(z.object({ number: integer, report: reportSchema.nullable(), wait: z.boolean() }))
    .parse(result.rows);
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
  const result = await db.query(
    `select scope,
    spent_micro_usd+reserved_micro_usd+$2 > limit_micro_usd as exhausted,
    active >= max_concurrent as busy from signal_desk.inference_budgets
    where scope in ('installation',$1) order by scope for update`,
    [userId, amount],
  );
  const rows = z
    .array(z.object({ scope: z.string(), exhausted: z.boolean(), busy: z.boolean() }))
    .parse(result.rows);
  if (rows.length !== 2 || rows.some((row) => row.exhausted))
    throw new AppError(429, "BUDGET_EXHAUSTED", "Inference budget is unavailable or exhausted.");
  if (rows.some((row) => row.busy))
    throw new AppError(429, "CONCURRENCY_LIMIT", "Inference concurrency limit reached.");
  await db.query(
    `update signal_desk.inference_budgets set
    reserved_micro_usd=reserved_micro_usd+$2, active=active+1 where scope in ('installation',$1)`,
    [userId, amount],
  );
}

async function admit(actor: Actor, request: Request, db: PoolClient): Promise<Admission> {
  await currentAccess(actor, request, db);
  const config = await db.query(
    "select * from signal_desk.inference_models where id=$1 and enabled",
    [request.model],
  );
  if (!config.rowCount) throw new AppError(503, "NOT_CONFIGURED", "Model is not configured.");
  const policy = policySchema.parse(config.rows[0]);
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
  const amount =
    inputBound * policy.input_micro_usd + policy.max_output_tokens * policy.output_micro_usd;
  await reserve(actor.userId, amount, db);
  await currentAccess(actor, request, db);
  const attemptId = randomUUID();
  await db.query(
    `insert into signal_desk.inference_attempts
    (id,operation_id,number,state,reserved_micro_usd,input_rate,output_rate,input_bound,output_bound,retry_ms,retry_after)
    values ($1,$2,$3,'dispatched',$4,$5,$6,$7,$8,$9::integer,clock_timestamp()+$9::integer*interval '1 millisecond')`,
    [
      attemptId,
      op.id,
      prior.number + 1,
      amount,
      policy.input_micro_usd,
      policy.output_micro_usd,
      inputBound,
      policy.max_output_tokens,
      policy.retry_ms,
    ],
  );
  return {
    kind: "dispatch",
    attemptId,
    maxInputTokens: inputBound,
    maxOutputTokens: policy.max_output_tokens,
    timeoutMs: policy.timeout_ms,
  };
}

async function settle(attemptId: string, report: Report, evidence: string | null, db: PoolClient) {
  const result = await db.query(
    `select a.*,o.user_id from signal_desk.inference_attempts a
    join signal_desk.inference_operations o on o.id=a.operation_id where a.id=$1 for update of a`,
    [attemptId],
  );
  if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Inference attempt not found.");
  const row = z
    .object({
      state: z.string(),
      report: reportSchema.nullable(),
      user_id: z.uuid(),
      reserved_micro_usd: z.coerce.number(),
      input_rate: integer,
      output_rate: integer,
      input_bound: integer,
      output_bound: integer,
    })
    .parse(result.rows[0]);
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
      ? report.inputTokens * row.input_rate + report.outputTokens * row.output_rate
      : 0;
  // Lock both scopes in the same order as admission.
  await db.query(
    "select scope from signal_desk.inference_budgets where scope in ('installation',$1) order by scope for update",
    [row.user_id],
  );
  await db.query(
    `update signal_desk.inference_budgets set reserved_micro_usd=reserved_micro_usd-$2,
    spent_micro_usd=spent_micro_usd+$3,active=active-1 where scope in ('installation',$1)`,
    [row.user_id, row.reserved_micro_usd, charge],
  );
  await db.query(
    `update signal_desk.inference_attempts set state=$2,report=$3,finished_at=clock_timestamp(),
    duration_ms=least(2147483647,extract(epoch from (clock_timestamp()-started_at))*1000)::integer,
    retry_after=clock_timestamp()+retry_ms*interval '1 millisecond',
    reconciliation_evidence=$4 where id=$1`,
    [attemptId, report.kind, JSON.stringify(report), evidence],
  );
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
      await db.query(
        "insert into signal_desk.inference_denials(id,user_id,code) values ($1,$2,$3)",
        [randomUUID(), userId.success ? userId.data : null, error.code],
      );
    }
    throw error;
  } finally {
    db.release();
  }
  if (admission.kind === "cached") return outcome(admission.report);
  const { attemptId, maxInputTokens, maxOutputTokens, timeoutMs } = admission;
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
          attemptId,
          signal: controller.signal,
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
    await database().query(
      `update signal_desk.inference_attempts set state='uncertain'
      where id=$1 and state='dispatched'`,
      [attemptId],
    );
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
  const permitted = await db.query(
    "select has_table_privilege(current_user,'signal_desk.inference_models','UPDATE') as allowed",
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
