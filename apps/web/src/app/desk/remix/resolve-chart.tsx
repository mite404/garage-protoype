"use client";
// Hatched bars in the Studio Admin style, drawn with recharts through the shared shadcn chart.
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@signal-desk/ui/components/ui/chart";

const config = {
  days: { label: "Average days", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/** Average days to resolve per blocker type, from simulated records passed by the server. */
export function ResolveChart({ data }: { data: { type: string; days: number }[] }) {
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ right: 48 }}>
        <defs>
          <pattern
            id="resolve-hatch"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill="var(--muted)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--color-days)" strokeWidth="1" />
          </pattern>
        </defs>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="type"
          width={150}
          tickLine={false}
          axisLine={false}
          fontSize={12}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel={false} />} />
        <Bar dataKey="days" fill="url(#resolve-hatch)" stroke="var(--border)" radius={[0, 6, 6, 0]}>
          <LabelList
            dataKey="days"
            position="right"
            formatter={(v) => `${Number(v).toFixed(1)} d`}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
