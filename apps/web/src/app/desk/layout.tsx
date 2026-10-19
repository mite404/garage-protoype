import type { ReactNode } from "react";
import DeskLayoutShell from "./desk-shell";

/** Shared chrome for the internal specialist desk. */
export default function DeskLayout({ children }: { children: ReactNode }) {
  return <DeskLayoutShell>{children}</DeskLayoutShell>;
}
