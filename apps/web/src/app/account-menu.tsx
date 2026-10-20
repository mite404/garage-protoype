"use client";

import { useEffect, useRef } from "react";

/** Account actions and a persisted appearance override; System follows the browser. */
export function AccountMenu({ signedIn }: { signedIn: boolean }) {
  const appearance = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (appearance.current)
      appearance.current.value = document.documentElement.dataset.theme || "system";
  }, []);
  return (
    <div className="account-control">
      <button
        className="account-avatar"
        popoverTarget="account-menu"
        aria-label="Account and appearance"
        title="Account and appearance"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
        </svg>
      </button>
      <div id="account-menu" popover="auto" className="account-popover">
        <p>{signedIn ? "Your workspace" : "Welcome to Signal Desk"}</p>
        <a href={signedIn ? "/account" : "/sign-in"}>{signedIn ? "Your account" : "Sign in"}</a>
        {signedIn && <a href="/desk">Work queue</a>}
        <label htmlFor="appearance">Appearance</label>
        <select
          id="appearance"
          ref={appearance}
          defaultValue="system"
          onChange={(event) => {
            const value = event.target.value;
            if (value === "system") delete document.documentElement.dataset.theme;
            else document.documentElement.dataset.theme = value;
            try {
              localStorage.setItem("signal-desk-theme", value);
            } catch {
              // Appearance still works for this page when storage is unavailable.
            }
          }}
        >
          <option value="system">System default</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        {signedIn && (
          <form action="/auth/sign-out" method="post">
            <button type="submit">Sign out</button>
          </form>
        )}
      </div>
    </div>
  );
}
