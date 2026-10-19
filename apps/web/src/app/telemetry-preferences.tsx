"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@signal-desk/ui/components/ui/button";
import { startLandingTelemetry } from "./landing-telemetry";

const replayEnabled = process.env.NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED === "true";
const statusText = {
  off: "Off",
  starting: "Starting",
  on: "On for this page",
  unavailable: "Unavailable. Nothing enabled.",
};

/** Offers per-visit diagnostic consent only on the static overview, never in private workspaces. */
export function TelemetryPreferences() {
  const [consent, setConsent] = useState<"off" | "starting" | "on" | "unavailable">("off");
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      attempt.current?.abort();
    };
  }, []);
  async function enable() {
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setConsent("starting");
    const dispose = await startLandingTelemetry(replayEnabled, controller.signal);
    if (controller.signal.aborted) return;
    setConsent(dispose ? "on" : "unavailable");
  }
  return (
    <section
      className="col-span-full border-t border-border pt-5 text-sm"
      aria-label="Usage diagnostics"
    >
      <p className="max-w-xl text-muted-foreground">
        Optional diagnostics for this overview only. No workspace, contact or document content.
        {replayEnabled && " Includes a recording with text, inputs and attributes masked."} Your
        choice resets when you leave this page. Stopping prevents new collection; already queued
        data may finish sending.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button
          variant="outline"
          disabled={consent === "starting"}
          onClick={() => {
            if (consent === "on") {
              attempt.current?.abort();
              attempt.current = null;
              setConsent("off");
            } else void enable();
          }}
        >
          {consent === "on" ? "Stop diagnostics" : "Allow diagnostics"}
        </Button>
        <output aria-live="polite">{statusText[consent]}</output>
      </div>
    </section>
  );
}
