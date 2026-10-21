import type { StreamActivity, StreamView } from "@signal-desk/contracts/assistance-schema";

// Labels for the owner's real steps; never a guess at what the model is deliberating.
const activityLabels = {
  reading_deal: "Reading the deal",
  checking_evidence: "Checking evidence",
  preparing_draft: "Preparing a draft",
  writing: "Writing a reply",
} satisfies Record<StreamActivity, string>;

// A submitted message and the saved turn IDs that existed when it was sent.
export type SentTurn = { message: string; known: string[] };

/** Whether a saved turn is still unfinished and should show live progress. */
export function isActiveTurn(turn: Pick<StreamView, "state">) {
  return ["queued", "running", "cancelling"].includes(turn.state);
}

/** The truthful current step of an unfinished turn, from its saved state and owner activity. */
export function progressLabel(turn: Pick<StreamView, "state" | "activity">) {
  if (turn.state === "cancelling") return "Stopping";
  if (turn.activity) return activityLabels[turn.activity];
  return "Queued";
}

/** The message to show as sending: only until a saved turn that did not exist at Send arrives. */
export function sendingMessage(sent: SentTurn | undefined, streams: Pick<StreamView, "id">[]) {
  if (!sent || streams.some((turn) => !sent.known.includes(turn.id))) return undefined;
  return sent.message;
}

/** Live status for an unfinished turn: an animated glyph that starts on mount, then a label.
 * The glyph is a rotating siren beam by default, or a three-bar wave. */
export function TurnProgress({
  label,
  spaced = false,
  glyph = "siren",
}: {
  label: string;
  spaced?: boolean;
  glyph?: "wave" | "siren";
}) {
  return (
    <output
      className={spaced ? "turn-progress turn-progress-spaced" : "turn-progress"}
      data-turn-progress=""
    >
      {glyph === "siren" ? (
        <span aria-hidden="true" className="turn-progress-siren" />
      ) : (
        <span aria-hidden="true" className="turn-progress-glyph">
          <span />
          <span />
          <span />
        </span>
      )}
      {label}…
    </output>
  );
}
