// "Resume last account" section shared by the remix layouts. Simulated, synthetic data only.
import Link from "next/link";
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@signal-desk/ui/components/ui/card";
import { recent } from "./data";

const fitTone = { Meets: "secondary", Unknown: "outline", Conflict: "destructive" } as const;

/** Last account the rep worked on: next action, why it is here, fit evidence and unknowns. */
export function Resume({ id }: { id?: string }) {
  const c = recent.connection;
  return (
    <Card id={id}>
      <CardHeader>
        <p className="text-xs font-medium text-muted-foreground uppercase">
          Resume last account · {c.buyer} ↔ {c.seller}
        </p>
        <CardTitle className="text-xl tracking-normal normal-case">{c.nextAction}</CardTitle>
        <p className="text-muted-foreground">
          Why here: “{recent.trigger.excerpt}” ({recent.trigger.source}). A research trigger, not
          proof of sale intent or authority.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {recent.fit.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 border-b border-border pb-2"
            >
              <dt>
                <span className="font-medium">{row.label}</span>
                <span className="block text-muted-foreground">
                  Need {row.need} · {row.evidence}
                </span>
              </dt>
              <dd>
                <Badge variant={fitTone[row.state as keyof typeof fitTone]}>{row.state}</Badge>
              </dd>
            </div>
          ))}
        </dl>
        <Link className="button w-fit" href="/desk/sourcing">
          Continue review
        </Link>
      </CardContent>
    </Card>
  );
}
