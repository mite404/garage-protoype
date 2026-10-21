import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { InlineCard } from "@signal-desk/contracts/assistance-schema";
import AssistanceCard from "./assistance-cards";

const answer = {
  kind: "answer",
  inquiryId: "synthetic-question-1",
  field: "pumpCapacity",
  value: "1,250 GPM",
  citation: {
    sourceLabel: "Synthetic brochure · Page 4",
    excerpt:
      "Pump rated capacity: 1,250 gallons per minute. This is a specification, not a pump-test result or a statement about current mechanical condition.",
  },
} satisfies InlineCard;

const review = {
  kind: "review",
  inquiryId: "synthetic-question-2",
  routingRevision: 0,
  state: "conflict",
  blockerId: "synthetic-blocker-1",
  question: "What is the tank capacity?",
  assigneeId: "specialist-demo",
  nextAction:
    "**Compare both sources before answering.**\n\n- Brochure: **750 gallons**\n- Seller note: **500 gallons**\n\n*Neither value is approved for a buyer reply.*",
} satisfies InlineCard;

const handoff = {
  kind: "handoff",
  inquiryId: "synthetic-offer-1",
  amountMinor: 16500000,
  currency: "USD",
  timingText: "Delivery before December",
  conditions: ["Review the pump-test report"],
  unansweredQuestions: ["Was the odometer photo legible?"],
  assigneeId: "specialist-demo",
  nextAction:
    "Specialist to review terms and request missing evidence. No acceptance or delivery promise.",
  status: "recorded_not_accepted",
} satisfies InlineCard;

const draft = {
  kind: "draft",
  draftId: "synthetic-draft-1",
  recipientLabel: "Seller (proposed, unverified)",
  body: "Could you supply a readable odometer photo and the pump-test report?\nWe will review both before replying to the buyer.",
  status: "unsent",
  reviewState: "current",
  purpose: "seller_request",
} satisfies InlineCard;

const meta = {
  title: "Agent catalog/Assistance cards",
  component: AssistanceCard,
  decorators: [
    (Story) => (
      <div className="w-[min(90vw,480px)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AssistanceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CitedAnswer: Story = { args: { card: answer } };
export const Conflict: Story = {
  args: { card: review },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: review.question })).toBeVisible();
    await expect(canvas.getByRole("list")).toBeVisible();
    await expect(canvas.getByText("750 gallons")).toHaveProperty("tagName", "STRONG");
    await expect(canvas.getByText("Neither value is approved for a buyer reply.")).toHaveProperty(
      "tagName",
      "EM",
    );
    await expect(canvas.getByText("Next human action")).toBeVisible();
  },
};
export const NeedsReview: Story = {
  args: {
    card: {
      ...review,
      state: "needs_review",
      nextAction: "Review the seller statement before sharing any value.",
    },
  },
};
export const Unknown: Story = {
  args: {
    card: {
      ...review,
      state: "unknown",
      nextAction: "Request a source for the missing pump-test result.",
    },
  },
};
export const HumanReview: Story = {
  args: {
    card: {
      ...review,
      state: "human_review",
      nextAction: "Ask the specialist to interpret the buyer's question.",
    },
  },
};
export const JevSuggested: Story = {
  args: {
    card: {
      ...review,
      state: "human_review",
      question: "How much water can it carry?",
      nextAction: "Clarify the buyer's intent with the assigned specialist.",
      suggestion: {
        state: "suggested",
        field: "tankCapacity",
        confidence: 0.98,
        modelVersion: "jev-1.13.0",
      },
    },
    onAcceptSuggestion: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Tank capacity · 98% confidence")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Use suggested field" }));
    await expect(args.onAcceptSuggestion).toHaveBeenCalledOnce();
  },
};
export const JevNeedsReview: Story = {
  args: {
    card: {
      ...review,
      state: "human_review",
      question: "Is the tank big enough for our department?",
      nextAction: "Clarify the buyer's intent with the assigned specialist.",
      suggestion: {
        state: "needs_review",
        reason: "judgment",
        confidence: 0.94,
        modelVersion: "jev-1.13.0",
      },
    },
  },
};
export const JevUnavailable: Story = {
  args: {
    card: {
      ...review,
      state: "human_review",
      question: "How much water can it carry?",
      nextAction: "Clarify the buyer's intent with the assigned specialist.",
      suggestion: { state: "unavailable", code: "NOT_CONFIGURED" },
    },
  },
};
export const OfferNotAccepted: Story = {
  args: { card: handoff },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Offer recorded · Not accepted")).toBeVisible();
    await expect(canvas.getByText("$165,000")).toBeVisible();
  },
};
export const EmptyConditions: Story = {
  args: { card: { ...handoff, conditions: [], unansweredQuestions: [] } },
};
export const UnsentDraft: Story = { args: { card: draft } };
export const StaleDraft: Story = { args: { card: { ...draft, reviewState: "stale" } } };

export const EvidenceReview: Story = {
  args: { card: review },
  render: () => (
    <section className="space-y-5">
      <p className="eyebrow">Synthetic specimen · Not connected to records</p>
      <h2>Evidence review</h2>
      <p className="text-sm">
        A brochure and seller note disagree. The specialist must resolve this before answering.
      </p>
      <AssistanceCard card={review} />
      <AssistanceCard card={answer} />
      <p className="text-xs text-muted-foreground">
        The answer above is a separate, reviewed synthetic example. No actions save or send data.
      </p>
    </section>
  ),
};
