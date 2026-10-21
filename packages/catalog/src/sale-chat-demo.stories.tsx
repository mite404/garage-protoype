import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import type {
  SourcingCardRef,
  SourcingStreamView,
  StreamActivity,
  StreamView,
} from "@signal-desk/contracts/assistance-schema";
import { evaluateFit, type SourcingAccount } from "@signal-desk/contracts/sourcing-schema";
import SaleChat from "./sale-chat";
import { DecisionChatCard, FitTable, SourceChangeCard } from "./sourcing-cards";

type Turn = StreamView | SourcingStreamView;

const observed = new Date("2026-10-18T00:00:00Z");
const sourcing: Pick<SourcingAccount, "need" | "facts" | "trigger" | "decision"> = {
  need: {
    id: "demo-need",
    buyer: "Pine Brook FD",
    buyerHref: "#pine-brook",
    vehicleClass: "Pumper",
    revision: 2,
    budgetBasis: "total",
    maxBudgetCents: 17_500_000,
    maxHeightIn: 120,
  },
  facts: [
    {
      id: "demo-height",
      field: "heightIn",
      value: 117,
      basis: "source_claim",
      sourceRef: "demo-spec",
      status: "accepted",
      reviewedAt: observed,
    },
  ],
  trigger: {
    id: "demo-trigger",
    excerpt: "Council approves replacement of Engine 3 in the spring budget.",
    sourceLabel: "Council minutes · Synthetic source",
    url: "https://example.org/synthetic/council-minutes",
    observedAt: observed,
  },
  // Recorded against revision 1, so the revised need marks it stale.
  decision: {
    decision: "investigate",
    reason: "Waiting for transport and fees.",
    decidedAt: observed,
    basis: { needRevision: 1, factIds: ["demo-height"] },
  },
};

// Each scripted turn shows one part of the inline catalog, in the order a specialist meets them.
const turn = (id: string, message: string, text: string, cards: Turn["cards"]) =>
  ({
    id,
    inquiryId: `demo-${id}`,
    message,
    state: "completed",
    text,
    cards,
    errorCode: null,
    activity: null,
  }) as Turn;

const script: Turn[] = [
  turn("answer", "Is the pump capacity confirmed?", "The spec sheet states it.", [
    {
      kind: "answer",
      inquiryId: "demo-answer",
      field: "pumpCapacity",
      value: "1,500 GPM",
      citation: {
        sourceLabel: "Synthetic spec sheet · Page 2",
        excerpt: "Rated pump capacity 1,500 gallons per minute at 150 psi.",
      },
    },
  ]),
  turn("conflict", "How large is the water tank?", "Two sources disagree.", [
    {
      kind: "review",
      inquiryId: "demo-conflict",
      routingRevision: 0,
      state: "conflict",
      blockerId: "demo-blocker-tank",
      question: "How large is the water tank?",
      assigneeId: "specialist-demo",
      nextAction: "- Spec sheet: **1,000 gallons**\n- Seller note: **750 gallons**",
    },
  ]),
  turn("unknown", "When was the last pump test?", "No source covers it yet.", [
    {
      kind: "review",
      inquiryId: "demo-unknown",
      routingRevision: 0,
      state: "unknown",
      blockerId: "demo-blocker-test",
      question: "When was the last pump test?",
      assigneeId: "specialist-demo",
      nextAction: "Ask the seller for the latest pump-test report.",
    },
  ]),
  turn("judgment", "Is it big enough for rural calls?", "This needs a specialist.", [
    {
      kind: "review",
      inquiryId: "demo-judgment",
      routingRevision: 0,
      state: "human_review",
      blockerId: "demo-blocker-rural",
      question: "Is it big enough for rural calls?",
      assigneeId: "specialist-demo",
      nextAction: "Clarify the buyer's water-supply needs before answering.",
      suggestion: {
        state: "needs_review",
        reason: "judgment",
        confidence: 0.91,
        modelVersion: "jev-1.13.0",
      },
    },
  ]),
  turn("offer", "Pine Brook offered $165,000.", "Recorded for review. Nothing is accepted.", [
    {
      kind: "handoff",
      inquiryId: "demo-offer",
      amountMinor: 16_500_000,
      currency: "USD",
      termsAmountMinor: 17_150_000,
      timingText: "Delivery before December",
      conditions: ["Pump test passes"],
      unansweredQuestions: ["Is the ladder certified?"],
      assigneeId: "specialist-demo",
      nextAction: "Compare the offer with current terms before replying.",
      status: "recorded_not_accepted",
    },
  ]),
  turn("draft", "Ask the seller for the pump-test report.", "Here is a draft to review.", [
    {
      kind: "draft",
      draftId: "demo-draft",
      recipientLabel: "Seller (proposed, unverified)",
      body: "Could you share the latest pump-test report, with its test date?",
      status: "unsent",
      reviewState: "current",
      purpose: "seller_request",
    },
  ]),
  turn("sourcing", "Does Cedar Valley's pumper fit Pine Brook?", "Height fits; cost is open.", [
    { kind: "sourcing", view: "source_change" },
    { kind: "sourcing", view: "fit" },
    { kind: "sourcing", view: "decision" },
  ]),
];

const rows = evaluateFit(sourcing.need, sourcing.facts);
const views = {
  source_change: <SourceChangeCard trigger={sourcing.trigger!} />,
  fit: <FitTable need={sourcing.need} rows={rows} />,
  decision: <DecisionChatCard account={sourcing} rows={rows} onOpen={() => {}} />,
} satisfies Partial<Record<SourcingCardRef["view"], unknown>>;
const steps: StreamActivity[] = ["reading_deal", "checking_evidence", "writing"];

// Plays each turn through the owner's real steps, then shows it complete with its cards.
function ScriptedChat({ stepMs }: { stepMs: number }) {
  const [tick, setTick] = useState(0);
  const done = Math.floor(tick / steps.length);
  useEffect(() => {
    if (done >= script.length) return;
    const timer = setTimeout(() => setTick((value) => value + 1), stepMs);
    return () => clearTimeout(timer);
  }, [tick, done, stepMs]);
  const current = script[done];
  const streams = current
    ? [
        ...script.slice(0, done),
        {
          ...current,
          state: "running",
          text: "",
          cards: [],
          activity: steps[tick % steps.length],
        } as Turn,
      ]
    : script;
  return (
    <SaleChat
      context="Synthetic demo · No model connected"
      streams={streams}
      pending={false}
      connection="Scripted replay"
      denied={false}
      onSubmit={async () => {}}
      onStop={() => {}}
      onAcceptSuggestion={() => {}}
      renderSourcingCard={(card) => views[card.view as keyof typeof views]}
    />
  );
}

const meta = {
  title: "Agent catalog/Scripted demo",
  component: ScriptedChat,
  parameters: { layout: "fullscreen" },
  args: { stepMs: 400 },
} satisfies Meta<typeof ScriptedChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InlineCatalog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Sale assistant/ }));
    const dialog = within(canvas.getByRole("dialog", { name: "Sale assistant" }));
    // The last card proves every earlier turn completed in order.
    const stale = await dialog.findByText(/Stale: the need/, {}, { timeout: 20_000 });
    await expect(stale).toBeVisible();
    for (const kind of ["answer", "review", "handoff", "draft", "source-change"])
      await expect(canvasElement.querySelector(`[data-card="${kind}"]`)).not.toBeNull();
    // The pinned window grows from its free top-left corner.
    const window = canvas.getByRole("dialog", { name: "Sale assistant" });
    const before = window.getBoundingClientRect().width;
    canvas.getByRole("button", { name: "Resize sale assistant" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(window.getBoundingClientRect().width).toBe(before + 24);
  },
};
