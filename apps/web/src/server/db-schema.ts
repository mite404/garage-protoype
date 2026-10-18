import {
  boolean,
  customType,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type {
  draftCommand,
  inquiryInput,
  RoutingSuggestion,
  StreamActivity,
} from "@signal-desk/contracts/assistance-schema";
import type { suggestPhotoRequest } from "@signal-desk/contracts/photo-schema";

const privateSchema = pgSchema("signal_desk");
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
// pg returns bigint as decimal strings, including arithmetic projections.
const int8 = customType<{ data: string; driverData: string }>({ dataType: () => "bigint" });

/** Server-owned model admission policies. */
export const inferenceModels = privateSchema.table("inference_models", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  max_input_bytes: integer("max_input_bytes").notNull(),
  max_photos: integer("max_photos").notNull(),
  photo_tokens: integer("photo_tokens").notNull(),
  overhead_tokens: integer("overhead_tokens").notNull(),
  max_output_tokens: integer("max_output_tokens").notNull(),
  input_micro_usd: integer("input_micro_usd").notNull(),
  output_micro_usd: integer("output_micro_usd").notNull(),
  rate_tokens: integer("rate_tokens").notNull().default(1),
  max_attempts: integer("max_attempts").notNull(),
  retry_ms: integer("retry_ms").notNull(),
  timeout_ms: integer("timeout_ms").notNull(),
});

/** Lifetime budget counters retain PostgreSQL bigint string semantics. */
export const inferenceBudgets = privateSchema.table("inference_budgets", {
  scope: text("scope").primaryKey(),
  limit_micro_usd: int8("limit_micro_usd").notNull(),
  spent_micro_usd: int8("spent_micro_usd").notNull().default("0"),
  reserved_micro_usd: int8("reserved_micro_usd").notNull().default("0"),
  max_concurrent: integer("max_concurrent").notNull(),
  active: integer("active").notNull().default(0),
});

/** Durable inference idempotency records. */
export const inferenceOperations = privateSchema.table("inference_operations", {
  id: uuid("id").primaryKey(),
  user_id: uuid("user_id").notNull(),
  request_key: text("request_key").notNull(),
  opportunity_id: text("opportunity_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  model_id: text("model_id").notNull(),
  max_attempts: integer("max_attempts").notNull(),
});

/** Each dispatched attempt reserves independently; reports are validated at settlement/read boundaries. */
export const inferenceAttempts = privateSchema.table("inference_attempts", {
  id: uuid("id").primaryKey(),
  operation_id: uuid("operation_id").notNull(),
  number: integer("number").notNull(),
  state: text("state").notNull(),
  reserved_micro_usd: int8("reserved_micro_usd").notNull(),
  input_rate: integer("input_rate").notNull(),
  output_rate: integer("output_rate").notNull(),
  rate_tokens: integer("rate_tokens").notNull().default(1),
  input_bound: integer("input_bound").notNull(),
  output_bound: integer("output_bound").notNull(),
  started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finished_at: timestamp("finished_at", { withTimezone: true }),
  duration_ms: integer("duration_ms"),
  retry_ms: integer("retry_ms").notNull(),
  retry_after: timestamp("retry_after", { withTimezone: true }).notNull(),
  report: jsonb("report").$type<unknown>(),
  reconciliation_evidence: text("reconciliation_evidence"),
});

/** Sanitized admission denials. */
export const inferenceDenials = privateSchema.table("inference_denials", {
  id: uuid("id").primaryKey(),
  user_id: uuid("user_id"),
  code: text("code").notNull(),
  decided_at: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable exact-locator source assertions. */
export const claims = privateSchema.table("claims", {
  id: text("id").primaryKey(),
  vehicle_id: text("vehicle_id").notNull(),
  source_id: text("source_id").notNull(),
  job_id: text("job_id").notNull(),
  field: text("field").notNull(),
  value: text("value").notNull(),
  unit: text("unit").notNull(),
  page: integer("page").notNull(),
  start_offset: integer("start_offset").notNull(),
  end_offset: integer("end_offset").notNull(),
  excerpt: text("excerpt").notNull(),
});

/** Append-only human evidence decisions. */
export const evidenceReviews = privateSchema.table("evidence_reviews", {
  id: text("id").primaryKey(),
  vehicle_id: text("vehicle_id").notNull(),
  opportunity_id: text("opportunity_id").notNull(),
  actor_id: uuid("actor_id").notNull(),
  field: text("field").notNull(),
  kind: text("kind").notNull(),
  claim_id: text("claim_id"),
  value: text("value").notNull(),
  unit: text("unit").notNull(),
  reason: text("reason").notNull(),
  basis: text("basis").notNull(),
  shareable: boolean("shareable").notNull().default(false),
  revision: integer("revision").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Model or human routing classifications; originals remain immutable. */
export const sourceClassifications = privateSchema.table("source_classifications", {
  id: text("id").primaryKey(),
  source_id: text("source_id").notNull(),
  job_id: text("job_id"),
  actor_id: uuid("actor_id"),
  kind: text("kind").notNull(),
  basis: text("basis").notNull(),
  next_action: text("next_action").notNull(),
  revision: integer("revision").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Buyer questions; stored input is parsed against the inquiry contract on read. */
export const inquiries = privateSchema.table("inquiries", {
  id: text("id").primaryKey(),
  opportunity_id: text("opportunity_id").notNull(),
  actor_id: uuid("actor_id").notNull(),
  request_key: text("request_key").notNull(),
  input: jsonb("input").$type<z.infer<typeof inquiryInput>>().notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only advisory suggestions, separate from human routing. */
export const inquirySuggestions = privateSchema.table("inquiry_suggestions", {
  inquiry_id: text("inquiry_id").primaryKey(),
  suggestion: jsonb("suggestion").$type<RoutingSuggestion>().notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only human inquiry routing. */
export const inquiryRouting = privateSchema.table("inquiry_routing", {
  id: text("id").primaryKey(),
  inquiry_id: text("inquiry_id").notNull(),
  actor_id: uuid("actor_id").notNull(),
  kind: text("kind").notNull(),
  field: text("field"),
  basis: text("basis").notNull(),
  revision: integer("revision").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Human-approved local drafts; JSON is validated by assistance contracts on read. */
export const assistanceDrafts = privateSchema.table("assistance_drafts", {
  id: text("id").primaryKey(),
  opportunity_id: text("opportunity_id").notNull(),
  actor_id: uuid("actor_id").notNull(),
  request_key: text("request_key").notNull(),
  input: jsonb("input").$type<z.infer<typeof draftCommand>>().notNull(),
  purpose: text("purpose").notNull(),
  recipient_label: text("recipient_label").notNull(),
  body: text("body").notNull(),
  basis_revision: integer("basis_revision").notNull(),
  evidence_basis: jsonb("evidence_basis")
    .$type<
      | ReturnType<typeof suggestPhotoRequest>
      | {
          inquiryId: string | null;
          blockerId: string | null;
          reviewId: string | null;
        }
    >()
    .notNull(),
  blocker_id: text("blocker_id"),
  review_id: text("review_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Durable conversation requests. */
export const chatTurns = privateSchema.table("chat_turns", {
  id: text("id").primaryKey(),
  opportunity_id: text("opportunity_id").notNull(),
  actor_id: uuid("actor_id").notNull(),
  request_key: text("request_key").notNull(),
  message: text("message").notNull(),
  inquiry_id: text("inquiry_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Durable tool-call envelopes validated by card contracts before rendering. */
export const cardCalls = privateSchema.table("card_calls", {
  turn_id: text("turn_id").notNull(),
  call_id: text("call_id").notNull(),
  tool: text("tool").notNull(),
  input: jsonb("input").$type<unknown>().notNull(),
  status: text("status").notNull(),
});

/** Existing application tokens; plaintext secrets are never stored. */
export const appTokens = privateSchema.table("app_tokens", {
  id: uuid("id").primaryKey(),
  user_id: uuid("user_id").notNull(),
  label: text("label").notNull(),
  token_hash: text("token_hash").notNull(),
  scopes: text("scopes").array().notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked_at: timestamp("revoked_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Private sale records; public disclosure uses separate projections. */
export const vehicles = privateSchema.table("vehicles", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ownerOrganizationId: text("owner_organization_id"),
  internal_notes: text("internal_notes").notNull().default(""),
  published_at: timestamp("published_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(0),
});

/** Organization metadata, without a separate access membership. */
export const organizations = privateSchema.table("organizations", {
  id: text("id").primaryKey(),
  buyerId: uuid("buyer_id"),
  name: text("name").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  unit: text("unit").notNull(),
  synthetic: boolean("synthetic").notNull(),
});

/** Proposed terms are distinct from reviewed vehicle evidence. */
export const opportunityDealTerms = privateSchema.table("opportunity_deal_terms", {
  opportunityId: text("opportunity_id").primaryKey(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  stage: text("stage").notNull(),
  conditions: text("conditions").array().notNull(),
});

/** Interest events deliberately have no message body or contact address. */
export const municipalityInterests = privateSchema.table("municipality_interests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  kind: text("kind").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});

/** Sale opportunities and their explicitly assigned specialists. */
export const opportunities = privateSchema.table("opportunities", {
  id: text("id").primaryKey(),
  vehicle_id: text("vehicle_id").notNull(),
  buyer_id: uuid("buyer_id").notNull(),
  assignee_id: uuid("assignee_id"),
  internal_notes: text("internal_notes").notNull().default(""),
  next_action: text("next_action").notNull().default(""),
});

/** Explicit opportunity membership, independent of identity role. */
export const opportunityMembers = privateSchema.table("opportunity_members", {
  opportunity_id: text("opportunity_id").notNull(),
  user_id: uuid("user_id").notNull(),
});

/** Immutable original evidence; stored pages are validated at evidence read boundaries. */
export const sources = privateSchema.table("sources", {
  id: text("id").primaryKey(),
  opportunity_id: text("opportunity_id").notNull(),
  owner_id: uuid("owner_id").notNull(),
  audience: text("audience").notNull().default("private"),
  name: text("name").notNull(),
  media_type: text("media_type").notNull(),
  content: bytea("content").notNull(),
  sha256: text("sha256").generatedAlwaysAs(sql`encode(sha256(content),'hex')`),
  kind: text("kind").notNull().default("document"),
  pages: jsonb("pages").$type<string[]>().notNull().default([]),
  shareable: boolean("shareable").notNull().default(false),
  permission: text("permission").notNull().default("permissioned"),
  provenance: text("provenance").notNull().default("Legacy source; permission needs confirmation"),
  blocker_id: text("blocker_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Explicit approved publication projection. */
export const publicFacts = privateSchema.table("public_facts", {
  vehicle_id: text("vehicle_id").notNull(),
  field: text("field").notNull(),
  value: text("value").notNull(),
  citation_excerpt: text("citation_excerpt").notNull(),
  source_label: text("source_label").notNull(),
  review_id: text("review_id"),
  approved_at: timestamp("approved_at", { withTimezone: true }),
  shareable: boolean("shareable").notNull().default(false),
});

/** Durable evidence tasks. */
export const evidenceBlockers = privateSchema.table("evidence_blockers", {
  id: text("id").primaryKey(),
  opportunity_id: text("opportunity_id").notNull(),
  blocker_key: text("blocker_key").notNull(),
  question: text("question").notNull(),
  field: text("field"),
  assignee_id: uuid("assignee_id").notNull(),
  next_action: text("next_action").notNull(),
  state: text("state").notNull().default("needs_review"),
});

/** Frozen import work and its fencing lease. */
export const importJobs = privateSchema.table("import_jobs", {
  id: text("id").primaryKey(),
  opportunity_id: text("opportunity_id").notNull(),
  actor_id: uuid("actor_id").notNull(),
  session_id: uuid("session_id"),
  app_token_id: uuid("app_token_id"),
  fingerprint: text("fingerprint").notNull(),
  model: text("model").notNull(),
  config: text("config").notNull(),
  input: text("input").notNull(),
  mode: text("mode").notNull().default("provider"),
  state: text("state").notNull().default("queued"),
  attempt: integer("attempt").notNull().default(1),
  fence: integer("fence").notNull().default(0),
  lease_until: timestamp("lease_until", { withTimezone: true }),
  error: text("error"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Import request idempotency. */
export const importKeys = privateSchema.table("import_keys", {
  actor_id: uuid("actor_id").notNull(),
  request_key: text("request_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  job_id: text("job_id").notNull(),
});

/** Exact source membership of a frozen import. */
export const importSources = privateSchema.table("import_sources", {
  job_id: text("job_id").notNull(),
  source_id: text("source_id").notNull(),
});

/** Append-only photo suggestions. */
export const photoSuggestions = privateSchema.table("photo_suggestions", {
  id: text("id").primaryKey(),
  source_id: text("source_id").notNull(),
  job_id: text("job_id").notNull(),
  view: text("view").notNull(),
  readable: boolean("readable").notNull(),
  reason: text("reason").notNull(),
  revision: integer("revision").notNull(),
});

/** Append-only human photo decisions. */
export const photoReviews = privateSchema.table("photo_reviews", {
  id: text("id").primaryKey(),
  source_id: text("source_id").notNull(),
  actor_id: uuid("actor_id").notNull(),
  view: text("view").notNull(),
  readable: boolean("readable").notNull(),
  approved: boolean("approved").notNull().default(false),
  reason: text("reason").notNull(),
  revision: integer("revision").notNull(),
});

/** Persisted credential references never contain plaintext tokens or passwords. */
export const credentialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("supabase-session"), sessionId: z.uuid() }).strict(),
  z.object({ kind: z.literal("app-token"), tokenId: z.uuid() }).strict(),
]);

/** Stream execution states are independent of whether a viewer is connected. */
export const streamState = z.enum([
  "queued",
  "running",
  "completed",
  "interrupted",
  "cancelling",
  "cancelled",
]);

/** Drizzle mapping of the existing private identity records; migrations remain in db/. */
export const identities = privateSchema.table("identities", {
  userId: uuid("user_id").primaryKey(),
  role: text("role", { enum: ["buyer", "specialist"] }).notNull(),
  canSpend: boolean("can_spend").notNull().default(false),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Application-owned admission and read projection; Flue retains its canonical execution log. */
export const streamTurns = privateSchema.table("stream_turns", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  credential: jsonb("credential").$type<z.infer<typeof credentialSchema>>().notNull(),
  inquiryId: text("inquiry_id").notNull(),
  message: text("message").notNull(),
  revision: integer("revision").notNull(),
  state: text("state").$type<z.infer<typeof streamState>>().notNull(),
  text: text("text").notNull(),
  submissionId: text("submission_id"),
  errorCode: text("error_code"),
  activity: text("activity").$type<StreamActivity>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
