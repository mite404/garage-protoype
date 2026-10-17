import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { StreamView } from "@signal-desk/contracts/assistance-schema";
import SaleChat from "./sale-chat";

const completed: StreamView = {
  id: "turn-1",
  inquiryId: "synthetic-1",
  message: "What is blocking the purchase?",
  state: "completed",
  text: "The pump-test evidence is still missing. **A specialist must review it.**",
  cards: [],
  errorCode: null,
};
const working: StreamView = {
  ...completed,
  id: "turn-2",
  state: "running",
  text: "Reviewing the contingent purchase conditions…",
};
const stopped: StreamView = {
  ...completed,
  id: "turn-3",
  state: "cancelled",
  text: "Partial draft retained.",
  errorCode: null,
};
const errored: StreamView = {
  ...completed,
  id: "turn-4",
  state: "interrupted",
  text: "Partial response retained.",
  errorCode: "SPEND_UNCERTAIN",
};

function Specimen({
  initialStreams = [],
  pending = false,
  denied = false,
  connection = "Connected · History saved",
  context = "Austin · Engine 001",
}: {
  initialStreams?: StreamView[];
  pending?: boolean;
  denied?: boolean;
  connection?: string;
  context?: string;
}) {
  const [streams, setStreams] = useState(initialStreams);
  const [submitted, setSubmitted] = useState("");
  const [stoppedId, setStoppedId] = useState("");
  return (
    <main className="min-h-screen p-5">
      <p>Simulated conversation. No network or external messages.</p>
      <output data-testid="submitted">{submitted}</output>
      <output data-testid="stopped">{stoppedId}</output>
      <SaleChat
        context={context}
        streams={streams}
        pending={pending}
        connection={connection}
        denied={denied}
        onSubmit={async (message) => {
          setSubmitted(message);
          setStreams((current) => [
            ...current,
            { ...completed, id: `turn-${current.length + 10}`, message },
          ]);
        }}
        onStop={(id) => {
          setStoppedId(id);
          setStreams((current) =>
            current.map((turn) => (turn.id === id ? { ...turn, state: "cancelled" } : turn)),
          );
        }}
      />
    </main>
  );
}

const meta = {
  title: "Municipal sales/Sale chat",
  component: SaleChat,
  parameters: { layout: "fullscreen" },
  render: ({ streams, pending, denied, connection, context }) => (
    <Specimen
      key={JSON.stringify(streams)}
      initialStreams={streams}
      pending={pending}
      denied={denied}
      connection={connection}
      context={context}
    />
  ),
} satisfies Meta<typeof SaleChat>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    context: "Austin · Engine 001",
    streams: [],
    pending: false,
    connection: "Connected",
    denied: false,
    onSubmit: async () => {},
    onStop: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = canvas.getByRole("button", { name: /Sale assistant/ });
    await userEvent.click(launcher);
    const composer = canvas.getByRole("textbox", { name: "Message sale assistant" });
    await expect(composer).toHaveFocus();
    await userEvent.type(composer, "Is pump evidence ready?");
    await userEvent.click(canvas.getByRole("button", { name: "Dismiss sale assistant" }));
    await expect(launcher).toHaveFocus();
    await userEvent.click(launcher);
    await expect(composer).toHaveValue("Is pump evidence ready?");
    await userEvent.click(canvas.getByRole("button", { name: "Minimize sale assistant" }));
    await userEvent.click(launcher);
    await expect(composer).toHaveValue("Is pump evidence ready?");
    await userEvent.click(canvas.getByRole("button", { name: "Send to sale assistant" }));
    await expect(canvas.getByTestId("submitted")).toHaveTextContent("Is pump evidence ready?");
    await expect(composer).toHaveValue("");
    await expect(canvas.getByText("Is pump evidence ready?")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(launcher).toHaveFocus();
    await userEvent.click(launcher);
    await expect(canvas.getByText("Is pump evidence ready?")).toBeVisible();
  },
};
export const WorkingText: Story = {
  ...Empty,
  args: { ...Empty.args, streams: [working] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Sale assistant/ }));
    await expect(canvas.getByText("Reviewing the contingent purchase conditions…")).toBeVisible();
    await expect(canvas.getByText("Sale assistant is working…")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Send to sale assistant" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Stop generation" }));
    await expect(canvas.getByTestId("stopped")).toHaveTextContent("turn-2");
    await expect(canvas.getByText("Incomplete · Stopped")).toBeVisible();
    await expect(canvas.queryByText("Sale assistant is working…")).not.toBeInTheDocument();
  },
};
export const StoppedAndError: Story = {
  ...Empty,
  args: { ...Empty.args, streams: [stopped, errored] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Sale assistant/ }));
    await expect(canvas.getByText("Incomplete · Stopped")).toBeVisible();
    await expect(canvas.getByText(/Budget remains reserved/)).toBeVisible();
  },
};
export const LongRetainedHistory: Story = {
  ...Empty,
  args: {
    ...Empty.args,
    streams: Array.from({ length: 24 }, (_, index) => ({
      ...completed,
      id: `history-${index}`,
      message: `Question ${index + 1}: Is the pump ready?`,
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Sale assistant/ }));
    const history = canvas.getByLabelText("Conversation history");
    history.scrollTop = history.scrollHeight;
    const composer = canvas.getByRole("textbox", { name: "Message sale assistant" });
    await expect(history.scrollHeight).toBeGreaterThan(history.clientHeight);
    await expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    await expect(composer).toBeVisible();
    await expect(canvas.getByText("Question 24: Is the pump ready?")).toBeVisible();
  },
};

export const Pending: Story = {
  ...Empty,
  args: { ...Empty.args, pending: true, connection: "Reconnecting…" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Sale assistant/ }));
    await expect(canvas.getByText("Reconnecting…")).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "Message sale assistant" })).toBeDisabled();
  },
};

export const AccessEnded: Story = {
  ...Empty,
  args: { ...Empty.args, denied: true, streams: [completed] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = canvas.getByRole("button", { name: /Sale assistant/ });
    await userEvent.click(launcher);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Conversation access ended");
    await expect(canvas.queryByRole("textbox", { name: "Message sale assistant" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Dismiss sale assistant" }));
    await expect(launcher).toHaveFocus();
  },
};

export const WorkingPreview: Story = {
  ...Empty,
  args: { ...Empty.args, streams: [working] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Sale assistant/ }));
    await expect(canvas.getByText("Sale assistant is working…")).toBeVisible();
  },
};
