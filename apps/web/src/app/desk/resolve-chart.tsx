"use client";
// Hatched horizontal bars from the approved Studio Admin CRM remix, drawn with recharts through
// the shared shadcn chart.
import { blockerDuration } from "@signal-desk/catalog/desk-state";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@signal-desk/ui/components/ui/chart";

const config = {
  hours: { label: "Average hours", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/** Average time to resolve per blocker kind, from the specialist's resolved blocker records. */
export function ResolveChart({ data }: { data: { kind: string; hours: number }[] }) {
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ right: 56 }}>
        <defs>
          <pattern
            id="resolve-hatch"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill="var(--muted)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--color-hours)" strokeWidth="1" />
          </pattern>
        </defs>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="kind"
          width={112}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          tick={{ fill: "var(--muted-foreground)" }}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel={false} />} />
        <Bar
          dataKey="hours"
          fill="url(#resolve-hatch)"
          stroke="var(--border)"
          isAnimationActive={false}
        >
          <LabelList
            dataKey="hours"
            position="right"
            fill="var(--foreground)"
            formatter={(value) => blockerDuration(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
