import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import {
  acceptSelected,
  evaluateFit,
  type SourcingAccount,
} from "@signal-desk/contracts/sourcing-schema";
import { DecisionPacket, FitTable, ReplyReview, SourceChangeCard } from "./sourcing-cards";
import SourcingWorkspace from "./sourcing-workspace";

const reviewedAt = new Date("2026-10-19T15:00:00Z");
const cedarValley: SourcingAccount = {
  account: {
    id: "synthetic-cedar-valley",
    name: "Cedar Valley Fire District",
    place: "Cedar Valley, NY",
    roles: ["seller"],
    synthetic: true,
  },
  owner: "Maya Chen",
  nextAction: "Review the reply. Height and sale timing are proposed, not yet reviewed.",
  trigger: {
    excerpt: "New pumper scheduled to enter service in November.",
    sourceLabel: "Replacement notice · Synthetic source",
    url: "https://example.org/synthetic/cedar-valley-notice",
    observedAt: new Date("2026-10-18T00:00:00Z"),
  },
  need: {
    id: "synthetic-pine-brook-need",
    buyer: "Pine Brook FD",
    buyerHref: "#pine-brook",
    vehicleClass: "Pumper",
    maxAllInCents: 17_500_000,
    maxHeightIn: 120,
  },
  inventorySearch: { searchedAt: new Date("2026-10-19T00:00:00Z"), reviewedMatches: 0 },
  contact: { identity: "reviewed", permission: "established" },
  outreach: { deliveryEnabled: false, state: "stopped", stopReason: "Reply received (simulated)" },
  replies: [
    {
      id: "synthetic-reply-1",
      channel: "email",
      receivedAt: new Date("2026-10-19T00:00:00Z"),
      text: "Maybe later, once the new truck arrives. Our current pumper is 121 inches tall.",
    },
  ],
  facts: [
    {
      id: "fact-sale",
      field: "saleStatus",
      value: "maybe_later",
      basis: "explicit_reply",
      sourceRef: "synthetic-reply-1",
      status: "proposed",
      reviewedAt: null,
    },
    {
      id: "fact-height",
      field: "heightIn",
      value: 121,
      basis: "ai_interpretation",
      sourceRef: "synthetic-reply-1",
      status: "proposed",
      reviewedAt: null,
    },
  ],
  decision: null,
};
const research: SourcingAccount = {
  ...cedarValley,
  nextAction: "Confirm availability and authority before buyer outreach.",
  contact: { identity: "pending_review", permission: "not_established" },
  outreach: { deliveryEnabled: false, state: "none", stopReason: null },
  replies: [],
  facts: [],
};

function Interactive({ data }: { data: SourcingAccount }) {
  const [state, setState] = useState(data);
  return (
    <SourcingWorkspace
      data={state}
      onSaveDraft={() => setState((s) => ({ ...s, outreach: { ...s.outreach, state: "draft" } }))}
      onAccept={(ids) =>
        setState((s) => ({ ...s, facts: acceptSelected(s.facts, ids, reviewedAt) }))
      }
      onDecide={(decision) =>
        setState((s) => ({ ...s, decision: { ...decision, decidedAt: reviewedAt } }))
      }
    />
  );
}

const meta = {
  title: "Sourcing/Account workspace",
  component: Interactive,
  parameters: { layout: "fullscreen", theme: "light" },
  decorators: [
    (Story, { parameters }) => (
      <div data-theme={parameters.theme}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Interactive>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Research: Story = {
  args: { data: research },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Research trigger only")).toBeVisible();
    await expect(canvas.getAllByText("Unknown")).toHaveLength(4);
    await expect(
      within(canvas.getByRole("table").parentElement!).getByText(/No recommendation until/),
    ).toBeVisible();
    await expect(canvas.getByRole("radio", { name: "Proceed" })).toBeDisabled();
    const body = canvas.getByLabelText("Message");
    await expect((body as HTMLTextAreaElement).value).toContain("exact overall height");
    await userEvent.clear(body);
    await userEvent.type(body, "Is it for sale?");
    await expect(canvas.getByRole("button", { name: "Save reviewed draft" })).toBeDisabled();
    await userEvent.type(body, " Reply STOP to opt out.");
    await userEvent.click(canvas.getByRole("button", { name: "Save reviewed draft" }));
    await expect(canvas.getByText("Reviewed draft · Not sent")).toBeVisible();
    await expect(canvas.getByText("Reviewed draft, not sent")).toBeVisible();
  },
};

export const ReplyRejectsPairing: Story = {
  args: { data: cedarValley },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/That rejects this pairing, not the seller account/),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("checkbox", { name: /Height: 121 in/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Save selected reviewed answers" }));
    const fit = within(canvas.getByRole("table"));
    await expect(fit.getByText("Does not meet")).toBeVisible();
    await expect(fit.getByText("121 in")).toBeVisible();
    // Sale timing was not selected, so it remains an unresolved proposal.
    await expect(
      canvas.getByRole("checkbox", { name: /Sale status: Maybe later/ }),
    ).not.toBeChecked();
    await expect(canvas.getByRole("radio", { name: "Reject" })).toBeChecked();
    await userEvent.type(canvas.getByLabelText("Reason"), "Reviewed height 121 in exceeds 120 in.");
    await userEvent.click(canvas.getByRole("button", { name: "Record decision" }));
    await expect(canvas.getByText("Recorded Oct 19, 2026")).toBeVisible();
    await expect(canvas.getByText(/need stays open after a rejection/)).toBeVisible();
  },
};

export const ChatCards: Story = {
  args: { data: cedarValley },
  render: ({ data }) => {
    const rows = evaluateFit(data.need, data.facts);
    return (
      <div className="grid w-[min(90vw,420px)] gap-4 p-4">
        <SourceChangeCard trigger={data.trigger} />
        <FitTable need={data.need} rows={rows} />
        <ReplyReview need={data.need} replies={data.replies} facts={data.facts} />
        <DecisionPacket need={data.need} rows={rows} decision={null} />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Proposed updates · Not yet approved")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Save selected reviewed answers" }),
    ).toBeDisabled();
  },
};

export const Dark: Story = { ...ReplyRejectsPairing, parameters: { theme: "dark" } };
