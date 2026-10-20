import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./workspace-shell";
import { AccountMenu } from "./account-menu";
import { requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";

export const metadata: Metadata = {
  title: "Signal Desk",
  description: "Independent vehicle evidence prototype.",
};

/** Keeps the independent-prototype label visible on every screen. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let signedIn = false;
  try {
    await requireActor();
    signedIn = true;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
  }
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const t=localStorage.getItem('signal-desk-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch{}`,
          }}
        />
      </head>
      <body>
        <AccountMenu signedIn={signedIn} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
