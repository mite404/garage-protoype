import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, type CSSProperties } from "react";
import { expect, within } from "storybook/test";
import { TurnProgress } from "./turn-progress";

const meta = {
  title: "Primitives/Working indicator",
  component: TurnProgress,
  parameters: { layout: "padded" },
  args: { label: "Checking evidence" },
} satisfies Meta<typeof TurnProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

// The enlarged copy has no label; this hides the ellipsis the indicator always appends.
const hideEllipsis = { "--muted-foreground": "transparent" } as CSSProperties;

// Each glyph at its real size beside its label, then enlarged so the motion is easy to judge.
const specimen = (glyph: "wave" | "siren", label: string) => (
  <figure className="grid justify-items-start gap-4" data-glyph={glyph}>
    <TurnProgress label={label} glyph={glyph} />
    <div aria-hidden="true" style={{ zoom: 6, ...hideEllipsis }}>
      <TurnProgress label="" glyph={glyph} />
    </div>
  </figure>
);

export const WaveAndSiren: Story = {
  render: () => (
    <div className="flex gap-16 text-foreground">
      {specimen("wave", "Checking evidence")}
      {specimen("siren", "Checking evidence")}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText("Checking evidence…")).toHaveLength(2);
    const siren = canvasElement.querySelector(".turn-progress-siren")!;
    // Reduced motion stops the sweep; otherwise the beam animates.
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    await expect(getComputedStyle(siren).animationName).toBe(
      still ? "none" : "turn-progress-siren",
    );
  },
};

type Tune = {
  label: string;
  glyph: "wave" | "siren";
  speed: number;
  paused: boolean;
  frame: number;
};

// Speed scales playback; pausing holds the animation at a frame given as a percentage of one cycle.
function tune(
  animation: Animation,
  { speed, paused, frame }: Pick<Tune, "speed" | "paused" | "frame">,
) {
  animation.playbackRate = speed;
  if (!paused) return animation.play();
  animation.pause();
  animation.currentTime = (Number(animation.effect?.getComputedTiming().duration) * frame) / 100;
}

// Drives the real CSS animation through the Web Animations API.
function Tuner({ label, glyph, speed, paused, frame }: Tune) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current
      ?.getAnimations({ subtree: true }) // → Animation[]
      .forEach((animation) => tune(animation, { speed, paused, frame }));
  }, [glyph, speed, paused, frame]);
  return (
    <div ref={root} className="grid justify-items-start gap-4 text-foreground">
      <TurnProgress label={label} glyph={glyph} />
      <div aria-hidden="true" style={{ zoom: 12, ...hideEllipsis }}>
        <TurnProgress label="" glyph={glyph} />
      </div>
    </div>
  );
}

export const Playground: StoryObj<typeof Tuner> = {
  render: (args) => <Tuner {...args} />,
  parameters: { controls: { include: ["glyph", "speed", "paused", "frame", "label"] } },
  args: { glyph: "siren", speed: 1, paused: false, frame: 50, label: "Checking evidence" },
  argTypes: {
    glyph: { control: "inline-radio", options: ["siren", "wave"] },
    speed: { control: { type: "range", min: 0.1, max: 3, step: 0.1 } },
    paused: { control: "boolean" },
    frame: { control: { type: "range", min: 0, max: 100, step: 1 }, if: { arg: "paused" } },
  },
};

// Held at mid-cycle, the beam faces the viewer and the siren is a solid red square.
export const SirenMidCycle: StoryObj<typeof Tuner> = {
  ...Playground,
  args: { ...Playground.args, paused: true, frame: 50 },
  play: async ({ canvasElement }) => {
    const [animation] = canvasElement.querySelector(".turn-progress-siren")!.getAnimations();
    await expect(animation!.playState).toBe("paused");
    await expect(animation!.currentTime).toBe(600);
  },
};
