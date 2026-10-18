import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ConversationTurn, LiteralProse, Prose } from "./prose";
import AssistanceCard from "./assistance-cards";

const meta = {
  title: "Conversation/Reading",
  component: Prose,
  decorators: [
    (Story) => (
      <div className="w-[min(90vw,660px)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Prose>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StructuredResponse: Story = {
  args: {
    text: "**The buyer is still waiting on two items.** The reviewed pump capacity is available, but that does not confirm the current condition of the pump.\n\n## What needs review\n\n- Resolve the tank-capacity conflict.\n- Request the current pump-test report.\n\n*An older brochure is not evidence of a current test.*\n\n## Next step\n\n**Ask the specialist to review both sources** before preparing a buyer reply. Keep the source reference `brochure-page-4` with the finding.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "What needs review" })).toBeVisible();
    await expect(canvas.getByRole("list")).toBeVisible();
    await expect(canvas.getByText("The buyer is still waiting on two items.")).toHaveProperty(
      "tagName",
      "STRONG",
    );
    await expect(
      canvas.getByText("An older brochure is not evidence of a current test."),
    ).toHaveProperty("tagName", "EM");
  },
};

export const LiteralEvidence: Story = {
  args: { text: "" },
  render: () => (
    <LiteralProse
      text={
        "Source reads **500 gallons**, not an approved value.\n\n<script>not executable</script>\nPreserve this line break."
      }
    />
  ),
};

export const ConnectedTurn: Story = {
  args: { text: "" },
  render: () => (
    <ConversationTurn request="What is the tank capacity?">
      <Prose
        text={
          "**A specialist must resolve the disagreement.**\n\nThe two source assertions are not interchangeable. No value is approved for a buyer reply."
        }
      />
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
      <p className="card-caveat">
        Synthetic reading specimen. No live model, save, or send action.
      </p>
    </ConversationTurn>
  ),
};
