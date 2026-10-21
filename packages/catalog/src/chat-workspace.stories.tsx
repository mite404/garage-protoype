import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChatWorkspace } from "./chat-workspace";

const meta = {
  title: "Conversation/Chat workspace",
  component: ChatWorkspace,
  parameters: { layout: "fullscreen" },
  args: {
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

function luminance(color: string) {
  const [red = 0, green = 0, blue = 0] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const checkMessageContrast: NonNullable<Story["play"]> = async ({ canvasElement }) => {
  const user = canvasElement.querySelector(".chat-message-user .chat-bubble");
  const assistant = canvasElement.querySelector(
    ".chat-message:not(.chat-message-user) .chat-bubble",
  );
  if (!user || !assistant) throw new Error("Both message roles must render.");
  const userStyle = getComputedStyle(user);
  const assistantStyle = getComputedStyle(assistant);
  const separation = contrast(userStyle.backgroundColor, assistantStyle.backgroundColor);
  await expect(separation).toBeGreaterThanOrEqual(1.2);
  await expect(separation).toBeLessThan(1.23);
  for (const style of [userStyle, assistantStyle]) {
    await expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  }
};

export const Default: Story = { play: checkMessageContrast };
export const EmailEditor: Story = { args: { initialEditorState: "open" } };
export const Minimized: Story = {
  args: { initialChatState: "minimized", initialEditorState: "minimized" },
};

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
