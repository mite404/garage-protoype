import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChatWorkspace } from "./chat-workspace";

const meta = {
  title: "Conversation/Chat workspace",
  component: ChatWorkspace,
  parameters: { layout: "fullscreen" },
  args: {
    theme: "light",
    context: {
      department: "Austin Fire Department",
      vehicle: "2014 Pierce Pumper",
      imageUrl: new URL("./assets/synthetic-pumper.webp", import.meta.url).href,
      proposal: "$84,000",
      condition: "Review pump-test evidence",
      blocker: "Report missing",
    },
    initialDraft: {
      recipientLabel: "San Antonio Fire Department",
      subject: "Pump-test report for 2014 Pierce Pumper",
      body: "Please share the latest pump-test report for review. Our proposed $84,000 purchase remains contingent on reviewing this evidence.",
    },
  },
} satisfies Meta<typeof ChatWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { args: { theme: "dark" } };
export const EmailEditor: Story = { args: { initialEditorState: "open" } };
export const DarkEmailEditor: Story = {
  args: { theme: "dark", initialEditorState: "open" },
};
export const Minimized: Story = {
  args: { initialChatState: "minimized", initialEditorState: "minimized" },
};
export const DarkMinimized: Story = { args: { ...Minimized.args, theme: "dark" } };

// Catches lost edits on minimize/close and saves that never update the visible draft card.
export const RetainsDraftEdits: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Edit draft" }));
    const editor = within(canvas.getByRole("dialog", { name: "Email draft" }));
    await userEvent.clear(editor.getByRole("textbox", { name: "Message" }));
    await userEvent.type(
      editor.getByRole("textbox", { name: "Message" }),
      "Please include the test date and pump serial number.",
    );
    await userEvent.click(editor.getByRole("button", { name: "Minimize email draft" }));
    await expect(canvas.queryByRole("dialog", { name: "Email draft" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("dialog", { name: "Sale assistant" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Open email draft" }));
    await expect(editor.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Please include the test date and pump serial number.",
    );
    await userEvent.click(editor.getByRole("button", { name: "Close email draft" }));
    await userEvent.click(canvas.getByRole("button", { name: "Open email draft" }));
    await userEvent.click(editor.getByRole("button", { name: "Save draft" }));
    await expect(canvas.getByText("Saved in this preview. Not sent.")).toBeVisible();
    await expect(
      canvas.getByText("Please include the test date and pump serial number.", { selector: "p" }),
    ).toBeInTheDocument();
    await userEvent.click(editor.getByRole("button", { name: "Minimize email draft" }));
    await userEvent.click(canvas.getByRole("button", { name: "Minimize sale assistant" }));
    await expect(canvas.getByRole("button", { name: "Open email draft" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Open sale assistant" }));
    await expect(
      canvas.getByText("Please include the test date and pump serial number.", { selector: "p" }),
    ).toBeInTheDocument();
  },
};

// Catches disappearing conversation text and treating a preview submit as a live model answer.
export const ComposesLocalMessage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Message sale assistant" }),
      "Does the report include a test date?",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Send to sale assistant" }));
    await expect(canvas.getByText("Does the report include a test date?")).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "Message sale assistant" })).toHaveValue("");
    await expect(canvas.getByText("Preview message added. No model connected.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Minimize sale assistant" }));
    await userEvent.click(canvas.getByRole("button", { name: "Open sale assistant" }));
    await expect(canvas.getByText("Does the report include a test date?")).toBeVisible();
  },
};
