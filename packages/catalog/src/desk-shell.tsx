import type { ReactNode } from "react";
import { Separator } from "@signal-desk/ui/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@signal-desk/ui/components/ui/sidebar";
import { TooltipProvider } from "@signal-desk/ui/components/ui/tooltip";

const icons = {
  queue: "M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1",
  buyers:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  accounts: "M4 21V3h16v18M2 21h20M8 7h1M15 7h1M8 11h1M15 11h1M10 21v-6h4v6",
  outcomes: "M4 21V11h4v10M10 21V3h4v18M16 21v-6h4v6",
  source: "M14 2H6v20h12V6zM14 2v5h5M9 12h6M9 16h6",
  target: "M22 12a10 10 0 1 1-10-10M18 12a6 6 0 1 1-6-6M12 12l9-9M16 3h5v5",
  inventory: "M3 6c0-5 18-5 18 0s-18 5-18 0M3 6v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0",
  available:
    "M1 5h14v12H1zM15 9h4l3 4v4h-7M7 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  height: "m3 17 14-14 4 4L7 21zM13 7l4 4M9 11l3 3M5 15l4 4",
  budget: "M12 2v20M18 6H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H5",
  authority: "M20 21v-3a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v3M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2",
  check: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M7.5 12.5l3 3 6-6.5",
  pending: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 7v5l3 2",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 11v6M12 7.5v.5",
  alert:
    "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0M12 9v4M12 17v.5",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  note: "M4 4h16v12l-4 4H4zM16 20v-4h4M8 9h8M8 13h5",
  spark: "M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19",
  reply: "M14 3H6v18h12V7zM14 3v4h4M9 14l2 2 4-4",
};

/** Line icon shared by desk navigation and evidence rows. */
export function DeskIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name]} />
    </svg>
  );
}

/** Desk destinations and route ownership, including seller pairings. */
export const deskNavigation = [
  { href: "/desk", label: "Work queue", icon: "queue", matches: /^\/desk\/?$/ },
  {
    href: "/desk/sourcing",
    label: "Buyer needs",
    icon: "buyers",
    matches: /^\/desk\/sourcing\/?$/,
  },
  {
    href: "/desk/prospects",
    label: "Accounts",
    icon: "accounts",
    matches: /^\/desk\/(prospects|accounts|sourcing\/[^/]+)/,
  },
  { href: "/desk/growth", label: "Outcomes", icon: "outcomes", matches: /^\/desk\/growth/ },
] as const;

const secondaryNavigation = [
  { href: "/desk/tokens", label: "MCP tokens", icon: "lock" },
  { href: "/vehicles/demo-pumper", label: "Public record", icon: "source" },
] as const;

/** Specialist navigation on shadcn sidebar-07 with one main landmark; municipal workspaces use
 * their own shell. Collapses to icons on desktop and to a sheet on mobile.
 */
export function DeskShell({ children, pathname }: { children: ReactNode; pathname: string }) {
  return (
    <TooltipProvider>
      <SidebarProvider className="desk-shell">
        <a className="dispatch-skip" href="#main-content">
          Skip to content
        </a>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  render={<a href="/desk" aria-label="Signal Desk home" />}
                >
                  <span className="desk-brand-mark" aria-hidden="true">
                    S
                  </span>
                  <span className="desk-brand">Signal Desk</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <nav aria-label="Workspace">
                <SidebarMenu>
                  {deskNavigation.map((item) => {
                    const current = item.matches.test(pathname);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={current}
                          tooltip={item.label}
                          render={
                            <a
                              href={item.href}
                              aria-label={item.label}
                              aria-current={current ? "page" : undefined}
                            />
                          }
                        >
                          <DeskIcon name={item.icon} />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </nav>
            </SidebarGroup>
            <SidebarGroup className="mt-auto">
              <SidebarGroupLabel>Tools</SidebarGroupLabel>
              <SidebarMenu>
                {secondaryNavigation.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      size="sm"
                      tooltip={item.label}
                      render={<a href={item.href} aria-label={item.label} />}
                    >
                      <DeskIcon name={item.icon} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="desk-body">
          <header className="sticky top-0 z-30 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-background py-2 pr-20 pl-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <a href="/desk" className="desk-brand md:hidden">
              Signal Desk
            </a>
            <p className="basis-full text-xs text-muted-foreground md:basis-auto">
              Independent prototype · Synthetic or permissioned data · Message sending disabled
            </p>
          </header>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          <footer className="px-6 py-5 text-[11px] text-muted-foreground">
            Independent prototype. Not affiliated with Garage. No messages, payments or commercial
            commitments.
          </footer>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

/** Account workspace tabs shared by server pages and interactive pairings. */
export const accountTabs = [
  { id: "overview", label: "Overview" },
  { id: "fit", label: "Vehicles & fit" },
  { id: "outreach", label: "Outreach" },
  { id: "sources", label: "Sources" },
  { id: "activity", label: "Activity" },
] as const;
export type AccountTab = (typeof accountTabs)[number]["id"];

/** Unknown URL tabs fall back to the account overview. */
export function accountTab(value: string | null | undefined): AccountTab {
  return accountTabs.find((tab) => tab.id === value)?.id ?? "overview";
}

function AccountTabs({ tab, onTab }: { tab: AccountTab; onTab?: (tab: AccountTab) => void }) {
  return (
    <nav className="desk-tabs" aria-label="Account sections">
      {accountTabs.map((item) => {
        const current = tab === item.id ? "page" : undefined;
        return onTab ? (
          <button key={item.id} aria-current={current} onClick={() => onTab(item.id)}>
            {item.label}
          </button>
        ) : (
          <a key={item.id} href={`?tab=${item.id}`} aria-current={current}>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

type Identity = {
  name: string;
  place: string;
  synthetic: boolean;
  context: string;
  secondary?: string;
  // Relationship to Garage this record establishes, e.g. a sourcing seller or a qualified buyer.
  role?: string;
};

function AccountHeader({
  name,
  place,
  synthetic,
  context,
  secondary,
  role = "Potential seller",
}: Identity) {
  return (
    <header className="desk-account-header">
      <a href="/desk/prospects" className="desk-back">
        ← Back to accounts
      </a>
      <div className="desk-identity">
        <div>
          <h1>{name}</h1>
          <span className="desk-role">{role}</span>
          <p>
            {place} · {synthetic ? "Synthetic fixture" : "USFA directory"}
          </p>
        </div>
        <div className="desk-owner">
          <span>{context}</span>
          <p>Owner: You</p>
          {secondary && <p>{secondary}</p>}
        </div>
      </div>
    </header>
  );
}

/** Account identity and evidence tabs with a caller-owned floating assistant. */
export function AccountFrame({
  name,
  place,
  synthetic,
  context,
  secondary,
  role,
  tab,
  onTab,
  children,
  chat,
}: Identity & {
  tab: AccountTab;
  onTab?: (tab: AccountTab) => void;
  children: ReactNode;
  chat?: ReactNode;
}) {
  return (
    <div className="desk-account">
      <div className="desk-account-main">
        <AccountHeader
          name={name}
          place={place}
          synthetic={synthetic}
          context={context}
          secondary={secondary}
          role={role}
        />
        <AccountTabs tab={tab} onTab={onTab} />
        <div className="desk-account-content">{children}</div>
      </div>
      {chat}
    </div>
  );
}

/** Highlights the next review without claiming that research establishes sale intent. */
export function NextAction({
  title,
  reason,
  action,
}: {
  title: string;
  reason: string;
  action: ReactNode;
}) {
  return (
    <section className="desk-next">
      <span className="desk-next-icon">
        <DeskIcon name="source" />
      </span>
      <div>
        <p>Next action</p>
        <h2>{title}</h2>
        <p>{reason}</p>
      </div>
      {action}
    </section>
  );
}
