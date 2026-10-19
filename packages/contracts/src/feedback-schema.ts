import { z } from "zod";

/** One version supplies both email wording and configured Forms choice IDs. */
export const feedbackSurvey = {
  version: "feedback-v1",
  interest: [
    { id: "ready", label: "Ready for a next step" },
    { id: "need_information", label: "Need more information" },
    { id: "not_now", label: "Not now" },
    { id: "not_interested", label: "Not interested" },
  ],
  blockers: [
    { id: "setup_effort", label: "Expected setup effort" },
    { id: "unclear_process", label: "Unclear process" },
    { id: "use_case", label: "Use-case mismatch" },
    { id: "pricing", label: "Pricing or fees" },
    { id: "timing", label: "Timing" },
    { id: "other", label: "Other" },
    { id: "none", label: "No blocker" },
  ],
} as const;

/** Explicit selections are separate from agent-inferred themes. */
export const feedbackAnswer = z
  .object({
    interest: z.enum(["ready", "need_information", "not_now", "not_interested"]),
    blocker: z.enum([
      "setup_effort",
      "unclear_process",
      "use_case",
      "pricing",
      "timing",
      "other",
      "none",
    ]),
    explanation: z.string().max(5000).default(""),
  })
  .strict();

/** Parses only complete unambiguous numeric replies. Everything else needs review. */
export function parseFeedbackReply(original: string): z.infer<typeof feedbackAnswer> | null {
  const match = original
    .trim()
    .match(
      /^(?:Interest\s*:\s*)?([1-4])(?:\s*[,;]\s*(?:Blocker\s*:\s*)?|\s+Blocker\s*:\s*)([1-7])\s*$/i,
    );
  if (!match) return null;
  const interest = feedbackSurvey.interest[Number(match[1]) - 1];
  const blocker = feedbackSurvey.blockers[Number(match[2]) - 1];
  return interest && blocker
    ? { interest: interest.id, blocker: blocker.id, explanation: "" }
    : null;
}

/** Produces the versioned post-call questions without a model or private deal data. */
export function feedbackEmail(reference: string, formsLink?: string) {
  return [
    `Feedback ${feedbackSurvey.version}. Reference ${reference}.`,
    "How interested are you?",
    ...feedbackSurvey.interest.map((choice, index) => `${index + 1}. ${choice.label}`),
    "What is your main blocker?",
    ...feedbackSurvey.blockers.map((choice, index) => `${index + 1}. ${choice.label}`),
    "Reply Interest: 2, Blocker: 1 (using your choices), or explain in your own words.",
    ...(formsLink ? [`Optional equivalent form: ${formsLink}`] : []),
    "Reply STOP to opt out. Links and references identify an invitation, not a verified person.",
  ].join("\n");
}
