import type { ReactNode } from "react";

type WorkspaceLink = {
  href: string;
  label: string;
  current: boolean;
};

/** Frames the human workspace; this shell is not an agent-selectable card. */
export function WorkspaceShell({
  children,
  links,
}: {
  children: ReactNode;
  links: WorkspaceLink[];
}) {
  return (
    <div className="dispatch-shell">
      <a className="dispatch-skip" href="#main-content">
        Skip to content
      </a>
      <header className="dispatch-header">
        <a className="dispatch-brand" href="/" aria-label="Signal Desk home">
          Signal Desk<span>Evidence before answers</span>
        </a>
        <p className="dispatch-disclaimer">
          Independent prototype
          <span>Not affiliated with Garage</span>
        </p>
      </header>
      <div className="dispatch-body">
        <nav className="dispatch-nav" aria-label="Main navigation">
          <p className="dispatch-nav-label">Sales workspace</p>
          {links.map((link) => (
            <a key={link.href} href={link.href} aria-current={link.current ? "page" : undefined}>
              <span className="dispatch-nav-mark" aria-hidden="true" />
              {link.label}
            </a>
          ))}
          <p className="dispatch-nav-note">
            Human review.
            <br />
            Every consequential step.
          </p>
        </nav>
        <div className="dispatch-content">
          <main id="main-content" className="dispatch-main" tabIndex={-1}>
            {children}
          </main>
          <footer className="dispatch-footer">
            Synthetic or permissioned material only. No messages, payments, or commercial
            commitments.
          </footer>
        </div>
      </div>
    </div>
  );
}
