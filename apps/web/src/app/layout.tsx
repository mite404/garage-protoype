import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./workspace-shell";

export const metadata: Metadata = {
  title: "Signal Desk",
  description: "Independent vehicle evidence prototype.",
};

/** Keeps the independent-prototype label visible on every screen. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
