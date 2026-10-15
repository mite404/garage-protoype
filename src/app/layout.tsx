import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal Desk",
  description: "Independent vehicle evidence prototype.",
};

/** Keeps the independent-prototype label visible on every screen. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
            <Link href="/" className="brand">
              Signal<span className="text-orange-700"> Desk</span>
            </Link>
            <span className="text-right text-xs text-stone-500">
              Independent prototype
              <br />
              Not affiliated with Garage
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-12 sm:py-16">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-stone-500">
          Synthetic or permissioned material only. No messages, payments, or commercial commitments.
        </footer>
      </body>
    </html>
  );
}
