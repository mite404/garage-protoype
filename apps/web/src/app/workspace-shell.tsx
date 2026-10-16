"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@signal-desk/catalog/workspace-shell";

const destinations = [
  { href: "/", label: "Overview" },
  { href: "/desk", label: "Workspace" },
  { href: "/vehicles/demo-pumper", label: "Public record" },
  { href: "/desk/tokens", label: "MCP tokens" },
];

/** Marks navigation from the current route without loading private records. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = destinations.findLast(
    ({ href }) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)),
  );
  return (
    <WorkspaceShell
      links={destinations.map((link) => ({ ...link, current: active?.href === link.href }))}
    >
      {children}
    </WorkspaceShell>
  );
}
