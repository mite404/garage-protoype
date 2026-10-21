import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Separator } from "./components/ui/separator";
import { Textarea } from "./components/ui/textarea";

const meta = {
  title: "Primitives/Foundations",
  component: Button,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PaletteAndType: Story = {
  render: () => (
    <div className="max-w-3xl space-y-6 text-foreground">
      <p className="eyebrow">Independent prototype · Dispatch</p>
      <h1>Evidence before answers.</h1>
      <p>
        Readable records and clear review states help a specialist move an interested buyer forward.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Background", "bg-background text-foreground"],
          ["Action", "bg-primary text-primary-foreground"],
          ["Foreground", "bg-foreground text-background"],
          ["Muted", "bg-muted text-foreground"],
        ].map(([name, colors]) => (
          <div key={name} className={`border border-border p-6 text-sm ${colors}`}>
            {name}
          </div>
        ))}
      </div>
      <Separator />
      <p className="text-sm text-muted-foreground">
        Space Grotesk for headings. Roboto for records and conversation.
      </p>
    </div>
  ),
};

export const ActionsAndStates: Story = {
  render: () => (
    <div className="flex max-w-xl flex-wrap items-center gap-3">
      <Button>Review evidence</Button>
      <Button variant="outline">Open source</Button>
      <Button variant="ghost">Cancel</Button>
      <Button disabled>Unavailable</Button>
      <Badge>Ready</Badge>
      <Badge variant="secondary">Needs review</Badge>
      <Badge variant="destructive">Conflict</Badge>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Review evidence" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Unavailable" })).toBeDisabled();
  },
};

export const EvidenceForm: Story = {
  render: () => (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Request a source</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <div className="space-y-2">
            <Label htmlFor="source-name">Source name</Label>
            <Input id="source-name" name="source" required placeholder="Pump-test report" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-note">Review note</Label>
            <Textarea id="source-note" name="note" placeholder="What still needs confirmation?" />
          </div>
          <Button type="submit">Check required fields</Button>
          <p className="text-xs text-muted-foreground">
            Story specimen only. Nothing is saved or sent.
          </p>
        </form>
      </CardContent>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Source name" });
    await userEvent.type(input, "Pump-test report");
    await expect(input).toHaveValue("Pump-test report");
    await expect(canvas.getByRole("textbox", { name: "Review note" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Check required fields" })).toBeEnabled();
  },
};
