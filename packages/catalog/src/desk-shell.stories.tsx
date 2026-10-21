import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { DeskShell } from "./desk-shell";
import AssistanceCard from "./assistance-cards";

const meta = {
  title: "Workspace/Desk shell",
  component: DeskShell,
  parameters: { layout: "fullscreen" },
  args: { pathname: "/desk/prospects/synthetic" },
} satisfies Meta<typeof DeskShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EvidenceReview: Story = {
  args: {
    children: (
      <section className="space-y-6">
        <div>
          <p className="eyebrow">Synthetic opportunity · Evidence review</p>
          <h1 className="mt-3">Keep the next step clear.</h1>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground">
            A buyer is waiting on tank capacity and a current pump-test report. Resolve the evidence
            before drafting a response.
          </p>
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <AssistanceCard
            card={{
              kind: "review",
              inquiryId: "synthetic-question",
              routingRevision: 0,
              state: "conflict",
              blockerId: "synthetic-tank-conflict",
              question: "What is the tank capacity?",
              assigneeId: "specialist-demo",
              nextAction:
                "**Compare both sources before answering.**\n\n- Brochure: **750 gallons**\n- Seller note: **500 gallons**\n\n*Neither value is approved for a buyer reply.*",
            }}
          />
          <AssistanceCard
            card={{
              kind: "draft",
              draftId: "synthetic-request",
              recipientLabel: "Seller (proposed, unverified)",
              body: "Could you provide the current pump-test report and a readable odometer photo? The specialist will review them before replying to the buyer.",
              status: "unsent",
              reviewState: "current",
              purpose: "seller_request",
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Storybook specimen only. Navigation stays in this preview. Nothing saves, sends, or
          accepts an offer.
        </p>
      </section>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getAllByRole("navigation", { name: "Workspace" })[0]!;
    await expect(within(nav).getByRole("link", { name: "Accounts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.getByText("Conflicting evidence")).toBeVisible();
    await expect(canvas.getByText("Unsent draft · Human review required")).toBeVisible();
  },
};
