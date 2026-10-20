import {
  boolean,
  type AnyPgColumn,
  customType,
  integer,
  jsonb,
  pgSchema,
  uniqueIndex,
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
  opportunity_id: text("opportunity_id"),
  prospect_id: text("prospect_id").references(() => growthAccounts.id),
  sourcing_case_id: text("sourcing_case_id").references(() => sourcingCases.id),
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
  // Exactly one subject: a deal turn or a sourcing turn (checked in the database).
  opportunity_id: text("opportunity_id"),
  sourcing_case_id: text("sourcing_case_id").references((): AnyPgColumn => sourcingCases.id),
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
  buyer_id: uuid("buyer_id"),
  organization_id: text("organization_id").references(() => organizations.id),
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
  dropped_claims: integer("dropped_claims").notNull().default(0),
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
  // Exactly one subject: a deal conversation or a pre-opportunity sourcing case.
  opportunityId: text("opportunity_id"),
  sourcingCaseId: text("sourcing_case_id").references(() => sourcingCases.id),
  actorId: uuid("actor_id").notNull(),
  credential: jsonb("credential").$type<z.infer<typeof credentialSchema>>().notNull(),
  // Deal turns answer one inquiry; sourcing turns have none.
  inquiryId: text("inquiry_id"),
  message: text("message").notNull(),
  revision: integer("revision").notNull(),
  state: text("state").$type<z.infer<typeof streamState>>().notNull(),
  text: text("text").notNull(),
  submissionId: text("submission_id"),
  errorCode: text("error_code"),
  activity: text("activity").$type<StreamActivity>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** Directory identity and human decisions are stored separately. Contacts are not identities. */
export const growthAccounts = privateSchema.table("growth_accounts", {
  id: text("id").primaryKey(),
  sourceKey: text("source_key").notNull().unique(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => identities.userId),
  organizationId: text("organization_id").references(() => organizations.id),
  opportunityId: text("opportunity_id").references(() => opportunities.id),
  // The draft listing that qualifying this seller created; a qualified prospect is a seller.
  listingVehicleId: text("listing_vehicle_id").references(() => vehicles.id),
  directory: jsonb("directory").$type<unknown>().notNull(),
  review: jsonb("review").$type<unknown>(),
  routing: text("routing").notNull().default("Unassigned; review territory"),
  identityState: text("identity_state").notNull().default("needs_review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable source snapshots retain changed assertions without overwriting human review. */
export const growthObservations = privateSchema.table(
  "growth_observations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => growthAccounts.id),
    snapshot: text("snapshot").notNull(),
    fingerprint: text("fingerprint").notNull(),
    original: jsonb("original").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_observation_identity").on(
      table.accountId,
      table.snapshot,
      table.fingerprint,
    ),
  ],
);

/** Operator-provisioned NY postal-prefix routes never grant global prospect access. */
export const growthTerritories = privateSchema.table("growth_territories", {
  id: text("id").primaryKey(),
  postalPrefix: text("postal_prefix").notNull().unique(),
  specialistId: uuid("specialist_id")
    .notNull()
    .references(() => identities.userId),
});

/** Append-only workflow events support auditable counts rather than inferred uplift. */
export const growthEvents = privateSchema.table("growth_events", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => growthAccounts.id),
  kind: text("kind").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Frozen reviewed message steps. A dispatch without a receipt is never automatically retried. */
export const growthMessages = privateSchema.table(
  "growth_messages",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => growthAccounts.id),
    enrollmentKey: text("enrollment_key").notNull(),
    step: integer("step").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => identities.userId),
    credential: jsonb("credential").$type<z.infer<typeof credentialSchema>>().notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    state: text("state", { enum: ["queued", "dispatched", "uncertain", "sent", "stopped"] })
      .notNull()
      .default("queued"),
    providerId: text("provider_id").unique(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("growth_message_step").on(table.accountId, table.enrollmentKey, table.step),
  ],
);

/** Global address suppression survives new enrollments and account reassignment. */
export const growthSuppressions = privateSchema.table("growth_suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Verified provider events are immutable and duplicate deliveries share one event ID. */
export const growthReceipts = privateSchema.table("growth_receipts", {
  id: text("id").primaryKey(),
  messageId: text("message_id").references(() => growthMessages.id),
  kind: text("kind").notNull(),
  original: jsonb("original").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Opaque invitation references correlate submissions but never authorize a profile read. */
export const growthInvitations = privateSchema.table(
  "growth_invitations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => growthAccounts.id),
    callKey: text("call_key").notNull(),
    recipient: text("recipient").notNull(),
    version: text("version").notNull(),
    stage: text("stage", { enum: ["post_call", "onboarding"] }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_invitation_call").on(table.accountId, table.callKey, table.version),
  ],
);

/** Original channel submissions are append-only; explicit and inferred answers never mix. */
export const growthFeedback = privateSchema.table(
  "growth_feedback",
  {
    id: text("id").primaryKey(),
    invitationId: text("invitation_id").references(() => growthInvitations.id),
    reference: text("reference").notNull(),
    channel: text("channel", { enum: ["email", "forms"] }).notNull(),
    externalId: text("external_id").notNull(),
    original: jsonb("original").$type<unknown>().notNull(),
    answer: jsonb("answer").$type<unknown>(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("growth_feedback_source").on(table.channel, table.externalId)],
);

/** Bounded background-agent output is advisory and retains its exact input fingerprint. */
export const growthInsights = privateSchema.table(
  "growth_insights",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => growthAccounts.id),
    inputHash: text("input_hash").notNull(),
    result: jsonb("result").$type<unknown>().notNull(),
    model: text("model").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("growth_insight_input").on(table.accountId, table.inputHash)],
);

/** Durable proactive work retains the initiating credential and a fencing lease. */
export const growthSchedules = privateSchema.table("growth_schedules", {
  id: text("id").primaryKey(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => identities.userId),
  credential: jsonb("credential").$type<z.infer<typeof credentialSchema>>().notNull(),
  configuration: jsonb("configuration").$type<unknown>().notNull(),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  fence: integer("fence").notNull().default(0),
  lastCode: text("last_code"),
  durationMs: integer("duration_ms"),
  watermark: timestamp("watermark", { withTimezone: true }).notNull().defaultNow(),
});

/** A confirmed buyer requirement owned by one specialist; it never implies a vehicle or deal. */
export const buyerNeeds = privateSchema.table("buyer_needs", {
  id: text("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => identities.userId),
  buyerOrganizationId: text("buyer_organization_id").references(() => organizations.id),
  buyerLabel: text("buyer_label").notNull(),
  // The confirmed statement and its permissioned provenance, retained verbatim.
  statement: text("statement").notNull(),
  provenance: text("provenance").notNull(),
  revision: integer("revision").notNull().default(1),
  constraints: jsonb("constraints").$type<unknown>().notNull(),
  state: text("state").notNull().default("active"),
  inventory: jsonb("inventory").$type<unknown>(),
  reviewAt: timestamp("review_at", { withTimezone: true }),
  synthetic: boolean("synthetic").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A connection between one buyer need and one seller, and once known the seller's vehicle; it
 * moves from investigating toward a closed sale, and rejection closes only this connection. */
export const sourcingCases = privateSchema.table(
  "sourcing_cases",
  {
    id: text("id").primaryKey(),
    needId: text("need_id")
      .notNull()
      .references(() => buyerNeeds.id),
    sellerProspectId: text("seller_prospect_id")
      .notNull()
      .references(() => growthAccounts.id),
    vehicleId: text("vehicle_id").references(() => vehicles.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => identities.userId),
    stage: text("stage").notNull().default("investigate"),
    nextAction: text("next_action").notNull(),
    decision: jsonb("decision").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sourcing_case_pairing").on(table.needId, table.sellerProspectId)],
);

/** A cited source change that triggered research; never proof of availability or permission. */
export const sourceChanges = privateSchema.table(
  "source_changes",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => sourcingCases.id),
    dedupeKey: text("dedupe_key").notNull(),
    sourceLabel: text("source_label").notNull(),
    url: text("url").notNull(),
    excerpt: text("excerpt").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    disposition: text("disposition").notNull().default("open"),
    synthetic: boolean("synthetic").notNull(),
  },
  // Dedupe per case, so the same public notice can trigger research for each owner's pairing.
  (table) => [uniqueIndex("source_change_case_key").on(table.caseId, table.dedupeKey)],
);

/** Proposed and reviewed answers for one pairing, each tied to its original source. */
export const pairingFacts = privateSchema.table("pairing_facts", {
  id: text("id").primaryKey(),
  caseId: text("case_id")
    .notNull()
    .references(() => sourcingCases.id),
  field: text("field").notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  basis: text("basis").notNull(),
  sourceRef: text("source_ref").notNull(),
  status: text("status").notNull().default("proposed"),
  reviewedBy: uuid("reviewed_by").references(() => identities.userId),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only pairing stages and reasons, separate from account-wide growth events. */
export const pairingEvents = privateSchema.table("pairing_events", {
  id: text("id").primaryKey(),
  caseId: text("case_id")
    .notNull()
    .references(() => sourcingCases.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => identities.userId),
  kind: text("kind").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One obstacle on a connection, open from when it was first seen until evidence resolves it.
 * A requirement that becomes unmet again opens a new row, so each row has one duration. */
export const connectionBlockers = privateSchema.table(
  "connection_blockers",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => sourcingCases.id),
    kind: text("kind").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("connection_blockers_open")
      .on(table.caseId, table.kind)
      .where(sql`resolved_at is null`),
  ],
);

/** One immutable account allocation, independent of contacts, flag changes and sourcing cases. */
export const outreachExperiments = privateSchema.table("outreach_experiments", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => growthAccounts.id),
  scopeId: uuid("scope_id")
    .notNull()
    .references(() => identities.userId),
  synthetic: boolean("synthetic").notNull(),
  variant: text("variant").$type<"control" | "evidence_first">().notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  enrollmentKey: text("enrollment_key"),
  exposedAt: timestamp("exposed_at", { withTimezone: true }),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
});

/** Minimal committed observations with historical scope; private originals never enter this queue. */
export const growthTelemetry = privateSchema.table("growth_telemetry", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => growthAccounts.id),
  scopeId: uuid("scope_id")
    .notNull()
    .references(() => identities.userId),
  synthetic: boolean("synthetic").notNull(),
  kind: text("kind").notNull(),
  variant: text("variant").$type<"control" | "evidence_first">(),
  messageId: text("message_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});
