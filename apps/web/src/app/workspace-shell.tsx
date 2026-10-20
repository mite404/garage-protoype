"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DeskShell } from "@signal-desk/catalog/desk-shell";

/** Marks navigation from the current route without loading private records. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (["/sign-in", "/sign-up", "/account"].includes(pathname)) return children;
  if (pathname === "/desk" || pathname.startsWith("/desk/")) return children;
  return <DeskShell pathname={pathname}>{children}</DeskShell>;
}
