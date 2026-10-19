import "server-only";
import { PostHog } from "posthog-node/edge";
import { z } from "zod";

const accountSchema = z.object({
  scopeId: z.uuid(),
  accountId: z.uuid(),
  synthetic: z.boolean(),
});
const variantSchema = z.enum(["control", "evidence_first"]);
const eventSchema = accountSchema.extend({
  key: z.string().min(1).max(500),
  kind: z.enum([
    "eligible",
    "assigned",
    "exposed",
    "qualified",
    "qualified_reply",
    "outreach_accepted",
    "outreach_delivered",
    "opportunity_created",
    "progressed",
    "closed_lost",
  ]),
  occurredAt: z.iso.datetime(),
  variant: variantSchema.optional(),
});
const configSchema = z.object({
  POSTHOG_ENABLED: z.literal("true"),
  POSTHOG_PROJECT_TOKEN: z.string().regex(/^phc_[a-zA-Z0-9_]+$/),
  POSTHOG_HOST: z.enum(["https://us.i.posthog.com", "https://eu.i.posthog.com"]),
  POSTHOG_ID_SALT: z.string().min(32),
});

function configuration() {
  const parsed = configSchema.safeParse(process.env);
  return parsed.success ? parsed.data : null;
}

async function pseudonym(salt: string, ...parts: string[]) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(parts)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientFor(config: z.infer<typeof configSchema>) {
  return new PostHog(config.POSTHOG_PROJECT_TOKEN, {
    host: config.POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 1500,
    featureFlagsRequestTimeoutMs: 1500,
    fetchRetryCount: 0,
    disableGeoip: true,
    enableLocalEvaluation: false,
    enableExceptionAutocapture: false,
    before_send: (event) => (event.event === "$feature_flag_called" ? null : event),
  });
}

/** Attempts an allowlisted committed observation. False means disabled, invalid or failed delivery.
 * Call after commit, using the durable event's original key and timestamp on every retry.
 * Vendor deduplication is best effort, not an exactly-once guarantee.
 */
export async function captureBusinessEvent(input: unknown): Promise<boolean> {
  const config = configuration();
  const parsed = eventSchema.safeParse(input);
  if (!config || !parsed.success) return false;
  const event = parsed.data;
  const client = clientFor(config);
  let failed = false;
  client.on("error", () => {
    failed = true;
  });
  try {
    const accountId = await pseudonym(config.POSTHOG_ID_SALT, event.scopeId, event.accountId);
    const eventId = await pseudonym(
      config.POSTHOG_ID_SALT,
      event.scopeId,
      event.accountId,
      event.key,
    );
    // UUIDv8: application-defined HMAC bytes with the RFC version and variant bits preserved.
    const uuid = [
      eventId.slice(0, 8),
      eventId.slice(8, 12),
      `8${eventId.slice(13, 16)}`,
      `${((parseInt(eventId.slice(16, 17), 16) & 3) | 8).toString(16)}${eventId.slice(17, 20)}`,
      eventId.slice(20, 32),
    ].join("-");
    await client.captureImmediate({
      uuid,
      distinctId: `account:${accountId}`,
      event: `growth_${event.kind}`,
      timestamp: new Date(event.occurredAt),
      properties: {
        $process_person_profile: false,
        synthetic: event.synthetic,
        schema_version: 1,
        ...(event.variant
          ? {
              experiment: "reviewed-outreach-v1",
              variant: event.variant,
              ...(event.kind === "exposed"
                ? { "$feature/reviewed-outreach-v1": event.variant }
                : {}),
            }
          : {}),
      },
    });
    return !failed;
  } catch {
    return false;
  } finally {
    await client.shutdown(1500).catch(() => undefined);
  }
}

/** Evaluates by scoped account, never contact. Persist once under the account lock before review.
 * Null leaves normal outreach available but outside the experiment; never invent a fallback arm.
 * Evaluation is not exposure. Record exposure only after the first confirmed delivery.
 */
export async function assignOutreachVariant(
  input: unknown,
): Promise<z.infer<typeof variantSchema> | null> {
  const config = configuration();
  const parsed = accountSchema.safeParse(input);
  if (!config || !parsed.success) return null;
  const { scopeId, accountId } = parsed.data;
  const client = clientFor(config);
  try {
    const flags = await client.evaluateFlags(
      `account:${await pseudonym(config.POSTHOG_ID_SALT, scopeId, accountId)}`,
      { flagKeys: ["reviewed-outreach-v1"], disableGeoip: true },
    );
    const variant = variantSchema.safeParse(flags.getFlag("reviewed-outreach-v1"));
    return variant.success ? variant.data : null;
  } catch {
    return null;
  } finally {
    await client.shutdown(1500).catch(() => undefined);
  }
}

/** Exports a fixed error category, never the original exception or request. */
export async function captureServerError(
  source: "request" | "import" | "stream",
): Promise<boolean> {
  const config = configuration();
  if (!config) return false;
  const client = clientFor(config);
  let failed = false;
  client.on("error", () => {
    failed = true;
  });
  try {
    await client.captureImmediate({
      distinctId: "signal-desk:service",
      event: "$exception",
      properties: {
        $process_person_profile: false,
        $exception_list: [
          {
            type: "SignalDeskFailure",
            value: `Unexpected ${source} failure. Private context withheld.`,
            mechanism: { type: "generic", handled: true },
          },
        ],
        $exception_fingerprint: ["signal-desk", source],
      },
    });
    return !failed;
  } catch {
    return false;
  } finally {
    await client.shutdown(1500).catch(() => undefined);
  }
}
