import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import type { MunicipalityWorkspace as Workspace } from "@signal-desk/contracts/municipality-schema";
import type { StreamView } from "@signal-desk/contracts/assistance-schema";
import MunicipalityWorkspace from "./municipality-workspace";
import SaleChat from "./sale-chat";

const workspace: Workspace = {
  organization: {
    id: "austin",
    name: "Austin Fire Department",
    city: "Austin",
    region: "Texas",
    unit: "Engine 001",
    synthetic: true,
  },
  thumbnails: {
    pumper: {
      url: new URL("./assets/synthetic-pumper.webp", import.meta.url).href,
      label: "Synthetic pumper illustration, not vehicle evidence",
    },
  },
  acquisitions: [
    {
      id: "synthetic-deal",
      vehicleId: "pumper",
      title: "2014 Pierce Pumper",
      seller: "San Antonio Fire Department",
      terms: {
        amountCents: 8400000,
        currency: "USD",
        stage: "contingent",
        conditions: ["Proceed only after pump-test evidence is reviewed."],
      },
    },
  ],
  activity: [
    {
      id: "contact",
      vehicleId: "pumper",
      title: "2014 Pierce Pumper",
      seller: "San Antonio Fire Department",
      kind: "contact",
      occurredAt: new Date("2025-03-10T00:00:00Z"),
    },
    {
      id: "favorite",
      vehicleId: "rescue",
      title: "2016 E-ONE Rescue",
      seller: null,
      kind: "favorite",
      occurredAt: new Date("2025-03-08T00:00:00Z"),
    },
  ],
  ownedListings: [
    {
      id: "tanker",
      title: "2008 Freightliner Tanker",
      publishedAt: new Date("2025-02-28T00:00:00Z"),
    },
    { id: "rescue-unlisted", title: "2011 Spartan Rescue", publishedAt: null },
  ],
};

const completedTurn: StreamView = {
  id: "synthetic-conversation",
  inquiryId: "synthetic-question",
  message: "What is blocking this purchase?",
  state: "completed",
  text: "The pump-test report is missing. The proposed $84,000 purchase remains contingent on its review. I can help prepare a request for the seller.",
  cards: [],
  errorCode: null,
  activity: null,
};

const suggestedTurn: StreamView = {
  id: "synthetic-jev-turn",
  inquiryId: "synthetic-jev-question",
  message: "How much water can it carry?",
  state: "completed",
  text: "This needs a routed evidence field before I can cite an answer.",
  cards: [
    {
      kind: "review",
      inquiryId: "synthetic-jev-question",
      routingRevision: 0,
      state: "human_review",
      blockerId: "synthetic-blocker-jev",
      question: "How much water can it carry?",
      assigneeId: "specialist-demo",
      nextAction: "Clarify the question's intent before preparing a reply.",
      suggestion: {
        state: "suggested",
        field: "tankCapacity",
        confidence: 0.98,
        modelVersion: "jev-1.13.0",
      },
    },
  ],
  errorCode: null,
  activity: null,
};

function PreviewChat({ initial = [completedTurn] }: { initial?: StreamView[] }) {
  const [connection, setConnection] = useState("Synthetic preview · No model connected");
  const [streams, setStreams] = useState<StreamView[]>(initial);

  return (
    <SaleChat
      context="Austin · Engine 001"
      streams={streams}
      pending={false}
      connection={connection}
      denied={false}
      onSubmit={async (message) =>
        setStreams([
          ...streams,
          {
            id: String(streams.length),
            inquiryId: "synthetic-preview",
            message,
            state: "completed",
            text: "Preview message recorded locally. No model or external messaging is connected.",
            cards: [],
            errorCode: null,
            activity: null,
          },
        ])
      }
      onStop={() => {}}
      onAcceptSuggestion={(inquiryId, revision) =>
        setConnection(`Accepted suggestion for ${inquiryId} at routing revision ${revision}`)
      }
    />
  );
}

const meta = {
  title: "Municipal sales/Workspace",
  component: MunicipalityWorkspace,
  parameters: { layout: "fullscreen" },
  args: { workspace, chat: <PreviewChat /> },
} satisfies Meta<typeof MunicipalityWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Austin Fire Department" })).toBeVisible();
    await expect(canvas.getByText(/Contacted San Antonio Fire Department/)).toBeVisible();
    await expect(canvas.getByText("$84,000")).toBeVisible();
    // Bought and sold vehicles share one card; only a published listing links to its record.
    const selling = within(canvas.getByRole("region", { name: "Selling" }));
    await expect(selling.getByText("Listed Feb 28, 2025")).toBeVisible();
    await expect(selling.getByText("Not published")).toBeVisible();
    await expect(selling.getAllByRole("link", { name: "Public record →" })).toHaveLength(1);
    await expect(
      within(canvas.getByRole("region", { name: "Active acquisition" })).getByRole("img", {
        name: "Synthetic pumper illustration, not vehicle evidence",
      }),
    ).toBeVisible();
  },
};
export const ChatOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Sale assistant" }));
    const dialog = canvas.getByRole("dialog", { name: "Sale assistant" });
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByText("What is blocking this purchase?")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Austin Fire Department" })).toBeVisible();
  },
};
export const EmptyActivityAndListings: Story = {
  args: { workspace: { ...workspace, activity: [], ownedListings: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("No favorites or seller contact activity recorded."),
    ).toBeVisible();
    await expect(canvas.getByText("No owned listings recorded.")).toBeVisible();
  },
};
export const NoDealTerms: Story = {
  args: {
    workspace: { ...workspace, acquisitions: [{ ...workspace.acquisitions[0], terms: null }] },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("No proposed amount or conditions recorded."),
    ).toBeVisible();
  },
};

// A saved turn mid-way through the owner's steps, after its first streamed text.
export const ChatWorking: Story = {
  args: {
    chat: (
      <PreviewChat
        initial={[
          completedTurn,
          {
            ...completedTurn,
            id: "synthetic-working",
            message: "Prepare a seller request for the pump-test report.",
            state: "running",
            text: "I'll check the recorded deal conditions before preparing anything.",
            activity: "checking_evidence",
          },
        ]}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Sale assistant/ }));
    const dialog = canvas.getByRole("dialog", { name: "Sale assistant" });
    await expect(within(dialog).getByText("Checking evidence…")).toBeVisible();
    await expect(within(dialog).queryByText("Writing a draft…")).toBeNull();
  },
};
export const ChatJevSuggestion: Story = {
  args: { chat: <PreviewChat initial={[completedTurn, suggestedTurn]} /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Sale assistant" }));
    const dialog = within(canvas.getByRole("dialog", { name: "Sale assistant" }));
    await expect(dialog.getByText("Tank capacity · 98% confidence")).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "Use suggested field" }));
    await expect(
      dialog.getByText("Accepted suggestion for synthetic-jev-question at routing revision 0"),
    ).toBeVisible();
  },
};
