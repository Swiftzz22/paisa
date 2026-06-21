import Link from "next/link";

type Tab = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const TABS: Tab[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1Z" />
      </svg>
    ),
  },
  {
    href: "/inbox",
    label: "Inbox",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      </svg>
    ),
  },
  {
    href: "/ask",
    label: "Ask",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    ),
  },
];

/**
 * Bottom-tab navigation shown only on screens narrower than `sm` (640px).
 * Sits in a fixed bar at the bottom of the viewport, respects the iOS safe
 * area, and surfaces a circular FAB above the centre for the most common
 * action (adding a transaction).
 */
export function BottomNav({ activeHref }: { activeHref?: string }) {
  return (
    <>
      {/* Spacer so content doesn't sit behind the fixed bar */}
      <div aria-hidden className="h-20 sm:hidden" />

      <nav
        aria-label="Primary"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-md sm:hidden dark:border-zinc-800 dark:bg-black/95"
      >
        <ul className="mx-auto flex max-w-md items-end justify-around">
          {TABS.slice(0, 2).map((t) => (
            <NavItem key={t.href} tab={t} active={isActive(t.href, activeHref)} />
          ))}
          <li className="-mt-7">
            <Link
              href="/transactions/new"
              aria-label="Add transaction"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg shadow-zinc-900/30 transition-transform active:scale-95 dark:bg-zinc-50 dark:text-zinc-900 dark:shadow-zinc-50/20"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </Link>
          </li>
          {TABS.slice(2).map((t) => (
            <NavItem key={t.href} tab={t} active={isActive(t.href, activeHref)} />
          ))}
        </ul>
      </nav>
    </>
  );
}

function NavItem({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <li className="flex-1">
      <Link
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className={
          "flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 text-[11px] " +
          (active
            ? "text-zinc-900 dark:text-zinc-50"
            : "text-zinc-500 dark:text-zinc-400")
        }
      >
        <span aria-hidden>{tab.icon}</span>
        <span>{tab.label}</span>
      </Link>
    </li>
  );
}

function isActive(href: string, activeHref?: string): boolean {
  if (!activeHref) return false;
  if (href === "/") return activeHref === "/";
  return activeHref.startsWith(href);
}
