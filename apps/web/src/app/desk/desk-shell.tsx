"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DeskShell } from "@signal-desk/catalog/desk-shell";

/** Selects desk navigation without duplicating municipal workspace landmarks. */
export default function DeskLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname.startsWith("/desk/municipalities/") ? (
    children
  ) : (
    <DeskShell pathname={pathname}>{children}</DeskShell>
  );
}
