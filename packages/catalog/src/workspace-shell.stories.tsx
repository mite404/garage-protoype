import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { WorkspaceShell } from "./workspace-shell";
import AssistanceCard from "./assistance-cards";

const links = [
  { href: "#overview", label: "Overview", current: false },
  { href: "#main-content", label: "Workspace", current: true },
  { href: "#vehicle", label: "Public record", current: false },
  { href: "#tokens", label: "MCP tokens", current: false },
];

const meta = {
  title: "Workspace/Dispatch",
  component: WorkspaceShell,
  parameters: { layout: "fullscreen" },
  args: { links },
} satisfies Meta<typeof WorkspaceShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EvidenceReview: Story = {
  args: {
    children: (
      <section className="space-y-6">
        <div>
          <p className="eyebrow">Synthetic opportunity · Evidence review</p>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">
            Keep the next step clear.
          </h1>
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
    await expect(canvas.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.getByText("Conflicting evidence")).toBeVisible();
    await expect(canvas.getByText("Unsent draft · Human review required")).toBeVisible();
  },
};
