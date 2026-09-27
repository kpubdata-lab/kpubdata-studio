/**
 * Define Studio common app shell and navigation layout.
 *
 * Manages left grouped sidebar, top header (Kubi search, Kubi button, avatar),
 * theme switching, mobile overlay, and global Kubi drawer mount in one place;
 * actual route content is injected via `Outlet`. Menu structure follows
 * `kpubdata_ui_prototype_v1.html` IA (WORKSPACE/DATA/AI/SYSTEM) (#247).
 */
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { LanguageSwitcher } from "@/shared/i18n/LanguageSwitcher";
import { useAuthStore } from "@/features/auth/store";
import { KubiDrawer } from "@/features/kubi/KubiDrawer";
import { KubiSearchInput } from "@/features/kubi/KubiSearchInput";
import { useUIStore } from "@/shared/hooks/useUIStore";

const sidebarLogoUrl = new URL("../../assets/logo/kpubdata-brand-assets/svg/horizontal_dark.svg", import.meta.url).href;
const sidebarSymbolUrl = new URL("../../assets/logo/kpubdata-brand-assets/svg/sidebar_dark.svg", import.meta.url).href;

/**
 * Pick header CTA (label/destination) matching current route (#6.4).
 *
 * On new build page, guide to "build list" instead of duplicate "new build";
 * on other pages, lead to new build. New IA's Discover/Add Data/Quality
 * placeholder screens don't overlap these conditions, so use default (new build)
 * (#247).
 *
 * @param pathname - Current route.
 * @returns Header CTA label and destination.
 */
function headerCtaFor(
  pathname: string,
  t: (key: string) => string,
): { to: string; label: string } {
  if (pathname === "/builds/new") return { to: "/builds", label: t("header.buildList") };
  if (pathname.startsWith("/builds/") && pathname.endsWith("/run"))
    return { to: pathname.replace(/\/run$/, "/artifacts"), label: t("header.viewArtifacts") };
  return { to: "/builds/new", label: t("header.newBuild") };
}

interface NavItem {
  /** Route destination */
  to: string;
  /** Label shown in sidebar */
  label: string;
  /** Link title (hover description) */
  description: string;
  /** Icon always shown to identify menu even in collapsed state */
  icon: ReactNode;
  /** Exact match for active (like index routes) */
  end?: boolean;
}

interface SidebarIconProps {
  /** Icon identifier for testing and debugging */
  name: string;
  /** SVG element that draws the icon */
  children: ReactNode;
}

/** Common linear SVG icon for sidebar without new icon dependencies. */
function SidebarIcon({ name, children }: SidebarIconProps) {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center"
      data-testid={`nav-icon-${name}`}
    >
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
        viewBox="0 0 24 24"
      >
        {children}
      </svg>
    </span>
  );
}

interface NavGroup {
  /** Group header label (uppercase, same as prototype IA) */
  label: string;
  items: NavItem[];
}

// Final IA (WORKSPACE/DATA/AI/SYSTEM) reflected directly in grouped nav model (#247).
// New Build Wizard (`/builds/new`) removed from menu but continues in route and header
// CTA — it's the only actual build creation flow until Add Data Workbench (#250)
// absorbs it.
function buildNavGroups(t: (key: string) => string): NavGroup[] {
  return [
  {
    label: t("nav.groupWorkspace"),
    items: [
      {
        to: "/",
        label: t("nav.home"),
        description: t("navDescription.home"),
        end: true,
        icon: (
          <SidebarIcon name="home">
            <path d="m3 11 9-8 9 8" />
            <path d="M5 10v10h14V10M9 20v-6h6v6" />
          </SidebarIcon>
        ),
      },
      {
        to: "/discover",
        label: t("nav.discover"),
        description: t("navDescription.discover"),
        icon: (
          <SidebarIcon name="discover">
            <circle cx="12" cy="12" r="9" />
            <path d="m15 9-2 4-4 2 2-4 4-2Z" />
          </SidebarIcon>
        ),
      },
      {
        to: "/workspace",
        label: t("nav.workspace"),
        description: t("navDescription.workspace"),
        icon: (
          <SidebarIcon name="workspace">
            <rect width="16" height="14" x="4" y="6" rx="2" />
            <path d="M9 6V4h6v2M4 11h16" />
          </SidebarIcon>
        ),
      },
    ],
  },
  {
    label: t("nav.groupData"),
    items: [
      {
        to: "/add",
        label: t("nav.addData"),
        description: t("navDescription.addData"),
        icon: (
          <SidebarIcon name="add">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </SidebarIcon>
        ),
      },
      {
        to: "/datasets",
        label: t("nav.datasets"),
        description: t("navDescription.datasets"),
        icon: (
          <SidebarIcon name="datasets">
            <ellipse cx="12" cy="5" rx="7" ry="3" />
            <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
          </SidebarIcon>
        ),
      },
      {
        to: "/builds",
        label: t("nav.builds"),
        description: t("navDescription.builds"),
        icon: (
          <SidebarIcon name="builds">
            <circle cx="12" cy="12" r="9" />
            <path d="m10 8 6 4-6 4V8Z" />
          </SidebarIcon>
        ),
      },
      {
        to: "/quality",
        label: t("nav.quality"),
        description: t("navDescription.quality"),
        icon: (
          <SidebarIcon name="quality">
            <circle cx="12" cy="12" r="9" />
            <path d="m8 12 3 3 5-6" />
          </SidebarIcon>
        ),
      },
    ],
  },
  {
    label: t("nav.groupAi"),
    items: [
      {
        to: "/kubi",
        label: t("nav.kubi"),
        description: t("navDescription.kubi"),
        icon: (
          <SidebarIcon name="kubi">
            <rect width="14" height="12" x="5" y="7" rx="3" />
            <path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" />
          </SidebarIcon>
        ),
      },
      {
        to: "/reports",
        label: t("nav.reports"),
        description: t("navDescription.reports"),
        icon: (
          <SidebarIcon name="reports">
            <path d="M6 3h9l3 3v15H6V3Z" />
            <path d="M14 3v4h4M9 12h6M9 16h6" />
          </SidebarIcon>
        ),
      },
    ],
  },
  {
    label: t("nav.groupSystem"),
    items: [
      {
        to: "/provider",
        label: t("nav.provider"),
        description: t("navDescription.provider"),
        icon: (
          <SidebarIcon name="provider">
            <path d="M4 21V7l8-4 8 4v14M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
          </SidebarIcon>
        ),
      },
      {
        to: "/monitoring",
        label: t("nav.monitoring"),
        description: t("navDescription.monitoring"),
        icon: (
          <SidebarIcon name="monitoring">
            <path d="M3 12h4l2-5 4 10 2-5h6" />
          </SidebarIcon>
        ),
      },
    ],
  },
  ];
}

/**
 * DOM theme value matching current theme mode.
 *
 * @param theme - Current theme mode stored in UI store.
 * @returns Final theme value to record in DOM `data-theme` attribute.
 */
function getResolvedTheme(theme: ReturnType<typeof useUIStore.getState>["theme"]):
  | "light"
  | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  return theme;
}

/**
 * Create common Tailwind classes matching sidebar link active/inactive state.
 *
 * @param isActive - Whether current route matches link.
 * @returns Class string with visual state applied.
 */
function navigationClassName({ isActive }: { isActive: boolean }) {
  return [
    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
    isActive
      ? "bg-sidebar-active text-sidebar-active-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active-foreground",
  ].join(" ");
}

/**
 * Extract single initial for avatar from logged-in email.
 *
 * Before login or when email is missing, show "?" to indicate "not yet signed in".
 * Actual avatar menu/profile screen will inherit this state in #263
 * (Email/Password Auth).
 *
 * @param email - Logged-in user email (null if missing).
 * @returns Single character to display in avatar.
 */
function avatarInitial(email: string | null): string {
  return email ? email.charAt(0).toUpperCase() : "?";
}

/**
 * App shell component applied to all Studio pages.
 *
 * @returns Complete layout including sidebar, header, content slot, and global
 *          Kubi drawer.
 */
export function Layout() {
  const { t } = useTranslation();
  const navGroups = buildNavGroups(t);
  const closeMobileSidebar = useUIStore((state) => state.closeMobileSidebar);
  const isMobileSidebarOpen = useUIStore((state) => state.isMobileSidebarOpen);
  const isDesktopSidebarCollapsed = useUIStore((state) => state.isDesktopSidebarCollapsed);
  const openKubiDrawer = useUIStore((state) => state.openKubiDrawer);
  const setTheme = useUIStore((state) => state.setTheme);
  const theme = useUIStore((state) => state.theme);
  const toggleMobileSidebar = useUIStore((state) => state.toggleMobileSidebar);
  const toggleDesktopSidebarCollapsed = useUIStore(
    (state) => state.toggleDesktopSidebarCollapsed,
  );
  const email = useAuthStore((state) => state.email);
  const { pathname } = useLocation();
  const headerCta = headerCtaFor(pathname, t);

  useEffect(() => {
    document.documentElement.dataset.theme = getResolvedTheme(theme);
  }, [theme]);

  useEffect(() => {
    closeMobileSidebar();
  }, [closeMobileSidebar]);

  // Allow closing mobile sidebar with ESC (a11y, proposal §12.2).
  // Desktop collapse is not an overlay, so not an ESC target — this handler checks
  // mobile state only. Kubi drawer's ESC handling is its own responsibility when open
  // (see KubiDrawer).
  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMobileSidebar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileSidebarOpen, closeMobileSidebar]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        {isMobileSidebarOpen ? (
          <button
            aria-label={t("layout.closeNav")}
            className="fixed inset-0 z-30 bg-zinc-950/45 lg:hidden"
            onClick={closeMobileSidebar}
            type="button"
          />
        ) : null}

          <aside
            data-tour="sidebar"
          className={[
            "fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-4 py-5 text-sidebar-foreground transition-all lg:static lg:translate-x-0",
            isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
            isDesktopSidebarCollapsed ? "lg:w-20 lg:px-2" : "lg:w-72",
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-3 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <Link aria-label={t("layout.homeLink")} className="flex min-w-0 items-center" to="/">
                  <img
                    alt="KPubData Studio"
                    className={["w-[156px] max-w-full", isDesktopSidebarCollapsed ? "lg:hidden" : ""].join(" ")}
                    src={sidebarLogoUrl}
                  />
                  <img
                    alt="KPubData Studio"
                    className={["hidden h-8 w-8", isDesktopSidebarCollapsed ? "lg:block" : ""].join(" ")}
                    src={sidebarSymbolUrl}
                  />
                </Link>
              </div>
             {/* Tagline belongs in Topbar (workspace/product context), so Sidebar keeps
                  only product name/logo (no duplication). */}
            </div>
            <button
              aria-label={t("layout.closeSidebar")}
              className="rounded-lg border border-sidebar-border p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-active-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar lg:hidden"
              onClick={closeMobileSidebar}
              type="button"
            >
              ✕
            </button>
             {/* Desktop-only expand/collapse toggle — unlike mobile close button, only
                 exposed on lg+ to stay always accessible (#247). This button itself
                 never hides even when collapsed. */}
            <button
              aria-label={isDesktopSidebarCollapsed ? t("layout.expandSidebar") : t("layout.collapseSidebar")}
              className="hidden shrink-0 rounded-lg border border-sidebar-border p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-active-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar lg:inline-flex"
              onClick={toggleDesktopSidebarCollapsed}
              type="button"
            >
              {isDesktopSidebarCollapsed ? "»" : "«"}
            </button>
          </div>

          <nav className="mt-2 flex flex-1 flex-col gap-5">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p
                  className={[
                    "px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted",
                    isDesktopSidebarCollapsed ? "lg:sr-only" : "",
                  ].join(" ")}
                >
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <NavLink
                      className={navigationClassName}
                      end={item.end}
                      key={item.to}
                      onClick={closeMobileSidebar}
                      title={item.description}
                      to={item.to}
                    >
                      {item.icon}
                      <span className={isDesktopSidebarCollapsed ? "lg:sr-only" : undefined}>
                        {item.label}
                      </span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}

            <div className="mt-auto space-y-1 border-t border-sidebar-border pt-3">
              <NavLink
                className={navigationClassName}
                onClick={closeMobileSidebar}
                title={t("navDescription.settings")}
                to="/settings"
              >
                <SidebarIcon name="settings">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1A7 7 0 0 0 15 6l-.3-2.5h-4L10.4 6a7 7 0 0 0-1.7 1L6.5 6 4.5 9.5 6.5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1A7 7 0 0 0 10.4 18l.3 2.5h4L15 18a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" />
                </SidebarIcon>
                <span className={isDesktopSidebarCollapsed ? "lg:sr-only" : undefined}>
                  {t("nav.settings")}
                </span>
              </NavLink>
            </div>
          </nav>

          <div
            className={[
              "mt-4 rounded-lg border border-sidebar-border bg-sidebar-hover p-3",
              isDesktopSidebarCollapsed ? "lg:sr-only" : "",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{t("layout.theme")}</p>
              <select
                aria-label={t("layout.themeSelect")}
                className="rounded-lg border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-sm text-sidebar-foreground"
                onChange={(event) => setTheme(event.target.value as "system" | "light" | "dark")}
                value={theme}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-0">
          <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  aria-label={t("layout.toggleSidebar")}
                  className="inline-flex rounded-lg border border-border bg-card p-2 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
                  onClick={toggleMobileSidebar}
                  type="button"
                >
                  ☰
                </button>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    KPubData Studio
                  </p>
                  <h1 className="truncate text-base font-semibold tracking-tight">
                    {t("layout.tagline")}
                  </h1>
                </div>
              </div>

               {/* Without min-w-0 here, this group loses its minimum-width protection,
                   shrinking smaller than its content (Kubi button/avatar) in
                   flex-shrink calculation — those non-truncate buttons overflow and
                   collide with left subtitle (390px width, UI audit #6-A). Removing
                   min-w-0 prevents this group from shrinking below its min-content,
                   letting the left group's truncated title shrink instead. */}
              <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
                <KubiSearchInput />

                <button
                  aria-haspopup="dialog"
                  aria-label={t("layout.openKubi")}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={openKubiDrawer}
                  type="button"
                >
                  <span aria-hidden="true">✨</span>
                  <span className="hidden sm:inline">Kubi</span>
                </button>

                <LanguageSwitcher />

                <Link
                  className="hidden rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex"
                  to={headerCta.to}
                >
                  {headerCta.label}
                </Link>

                 {/* Avatar entry point — will expand to actual profile/logout menu in #263
                      (#247). */}
                <Link
                  aria-label={email ? t("layout.accountSettings", { email }) : t("layout.signInNeededAria")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-foreground hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  title={email ?? t("layout.signInNeeded")}
                  to="/settings"
                >
                  {avatarInitial(email)}
                </Link>
              </div>
            </div>
          </header>

          <Outlet />
        </div>
      </div>

      <KubiDrawer />
    </div>
  );
}
