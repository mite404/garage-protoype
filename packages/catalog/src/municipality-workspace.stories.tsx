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
  ],
};

function PreviewChat() {
  const [streams, setStreams] = useState<StreamView[]>([
    {
      id: "synthetic-conversation",
      inquiryId: "synthetic-question",
      message: "What is blocking this purchase?",
      state: "completed",
      text: "The pump-test report is missing. The proposed $84,000 purchase remains contingent on its review. I can help prepare a request for the seller.",
      cards: [],
      errorCode: null,
    },
  ]);
  return (
    <SaleChat
      context="Austin · Engine 001"
      streams={streams}
      pending={false}
      connection="Synthetic preview · No model connected"
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
          },
        ])
      }
      onStop={() => {}}
    />
  );
}

const meta = {
  title: "Municipal sales/Workspace",
  component: MunicipalityWorkspace,
  parameters: { layout: "fullscreen", theme: "light" },
  args: { workspace, chat: <PreviewChat /> },
  decorators: [
    (Story, { parameters }) => (
      <div data-theme={parameters.theme}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MunicipalityWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Austin Fire Department" })).toBeVisible();
    await expect(canvas.getByText(/Contacted San Antonio Fire Department/)).toBeVisible();
    await expect(canvas.getByText("$84,000")).toBeVisible();
    await expect(
      within(canvas.getByRole("region", { name: "Active acquisition" })).getByRole("img", {
        name: "Synthetic pumper illustration, not vehicle evidence",
      }),
    ).toBeVisible();
  },
};
export const Dark: Story = { ...Default, parameters: { theme: "dark" } };
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
export const DarkChatOpen: Story = { ...ChatOpen, parameters: { theme: "dark" } };
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
