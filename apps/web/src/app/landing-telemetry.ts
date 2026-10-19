import type { PostHogConfig } from "posthog-js";

function replayMetadata(data: unknown) {
  const href = window.location.origin + "/";
  if (!data || typeof data !== "object") return { href };
  return {
    href,
    width: "width" in data ? data.width : undefined,
    height: "height" in data ? data.height : undefined,
  };
}

function landingConfiguration(signal: AbortSignal) {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (
    signal.aborted ||
    window.location.pathname !== "/" ||
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED !== "true" ||
    !token?.startsWith("phc_") ||
    (host !== "https://us.i.posthog.com" && host !== "https://eu.i.posthog.com")
  )
    return null;
  return { token, host };
}

/** The landing-page recorder masks text, attributes and inputs and blocks every other subtree. */
export const landingTelemetryOptions = {
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_exceptions: false,
  capture_performance: false,
  enable_recording_console_log: false,
  disable_surveys: true,
  disable_surveys_automatic_display: true,
  disable_session_recording: true,
  disable_external_dependency_loading: true,
  advanced_disable_feature_flags: true,
  person_profiles: "never",
  persistence: "memory",
  disable_persistence: true,
  save_referrer: false,
  custom_campaign_params: [],
  session_recording: {
    maskAllInputs: true,
    maskTextSelector: "*",
    maskAllElementAttributes: true,
    blockSelector:
      "body :not([data-replay-safe]):not([data-replay-safe] *):not(:has([data-replay-safe])), img, svg, canvas, video, audio, iframe, object, embed, input[type=hidden], input[type=file], script",
    recordCrossOriginIframes: false,
    captureJsonLd: false,
    collectFonts: false,
    inlineStylesheet: false,
    recordHeaders: false,
    recordBody: false,
    maskCapturedNetworkRequestFn: () => null,
  },
  before_send(event) {
    if (window.location.pathname !== "/") return null;
    if (event.event !== "overview_opened" && event.event !== "$snapshot") return null;
    const snapshots: unknown = event.properties.$snapshot_data;
    if (event.event === "$snapshot" && !Array.isArray(snapshots)) return null;
    const safeSnapshots = Array.isArray(snapshots)
      ? snapshots.flatMap((snapshot: unknown) => {
          if (!snapshot || typeof snapshot !== "object" || !("type" in snapshot)) return [];
          if (snapshot.type === 4) {
            const data = "data" in snapshot ? snapshot.data : null;
            return [{ ...snapshot, data: replayMetadata(data) }];
          }
          return [0, 1, 2, 3].includes(Number(snapshot.type)) ? [snapshot] : [];
        })
      : undefined;
    // Replace rather than blacklist SDK properties. URLs, referrers and campaign values are private.
    return {
      uuid: event.uuid,
      event: event.event,
      timestamp: event.timestamp,
      properties: {
        token: event.properties.token,
        distinct_id: event.properties.distinct_id,
        $session_id: event.properties.$session_id,
        $window_id: event.properties.$window_id,
        $current_url: window.location.origin + "/",
        $geoip_disable: true,
        $process_person_profile: false,
        ...(event.event === "$snapshot"
          ? {
              $snapshot_data: safeSnapshots,
              $snapshot_bytes: event.properties.$snapshot_bytes,
            }
          : {}),
      },
    };
  },
} satisfies Partial<PostHogConfig>;

/** Starts for one consent lifetime. Abort cancels startup and new collection, not accepted requests. */
export async function startLandingTelemetry(replay: boolean, signal: AbortSignal) {
  const config = landingConfiguration(signal);
  if (!config) return null;
  try {
    const { PostHog } = await import("posthog-js/full/no-external");
    if (!landingConfiguration(signal)) return null;
    const client = new PostHog();
    let active = true;
    const stop = () => {
      if (!active) return;
      active = false;
      signal.removeEventListener("abort", stop);
      client.opt_out_capturing();
      client.stopSessionRecording();
      // Supported shutdown drains previously accepted work; it does not retract that data.
      void client.shutdown().catch(() => undefined);
    };
    client.init(config.token, {
      ...landingTelemetryOptions,
      api_host: config.host,
      before_send: (event) =>
        active && !signal.aborted ? landingTelemetryOptions.before_send(event) : null,
    });
    signal.addEventListener("abort", stop, { once: true });
    client.opt_in_capturing();
    client.capture("overview_opened");
    if (replay)
      client.startSessionRecording({
        sampling: true,
        linked_flag: true,
        url_trigger: true,
        event_trigger: true,
      });
    return stop;
  } catch {
    return null;
  }
}
