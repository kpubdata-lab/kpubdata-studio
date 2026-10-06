/**
 * Define Studio common app shell and navigation layout.
 *
 * Manages the left grouped sidebar, the topbar (breadcrumb on the left; search, Ask
 * KPubData and the account menu on the right, #523), theme application, the mobile
 * overlay and the global Ask KPubData drawer mount in one place;
 * actual route content is injected via `Outlet`. Menu structure follows
 * `kpubdata_ui_prototype_v1.html` IA (WORKSPACE/DATA/AI/SYSTEM) (#247).
 */
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AssistantDrawer } from "@/features/assistant/AssistantDrawer";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { VersionMismatchBanner } from "@/features/version-check/VersionMismatchBanner";
import { AccountMenu } from "./AccountMenu";
import { crumbsFor, documentTitleFor } from "./breadcrumb";
import { CommandSearch, type SearchDestination } from "./CommandSearch";
import { ensureAdminChecked, useAdminStore } from "@/features/admin/store";
import { signOutOfOidc } from "@/features/auth/signOut";
import { useAuthStore } from "@/features/auth/store";
import { SessionRefusedNotice } from "@/features/onboarding/SessionRefusedNotice";
import { SignupStatusNotice } from "@/features/onboarding/SignupStatusNotice";
import { isRealBuilderEnabled } from "@/shared/lib/builderApi";
import { clearSessionRefusal, useSessionRefusalStore } from "@/shared/lib/sessionRefusal";
import { useSignupStatusStore } from "@/shared/lib/signupStatus";
import { focusRouteTarget } from "./routeFocus";
import { BrandLogo, DemoBadge } from "@/shared/ui";


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
  /** Group heading; absent for the ungrouped Home entry. */
  label?: string;
  items: NavItem[];
}

// Warehouse IA (#423): what a person does with data — find it, keep it as tables,
// analyse it, operate it — instead of the build console's Discover · Add Data ·
// Datasets · Builds. Home carries no group label. Creating a table is an action on
// Catalog and Tables, not a destination, so Add Data (`/add`) and New Build
// (`/builds/new`) keep their routes but leave the menu. SQL Workspace and Saved
// Queries join ANALYZE when those screens exist (#417); a link to nothing is worse
// than no link. Connections sits with Settings at the bottom. URLs are unchanged —
// renaming them needs redirects and is separate work.
function buildNavGroups(t: (key: string) => string, isAdmin: boolean): NavGroup[] {
  return [
  {
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
    ],
  },
  {
    label: t("nav.groupData"),
    items: [
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
        to: "/tables",
        label: t("nav.datasets"),
        description: t("navDescription.datasets"),
        icon: (
          <SidebarIcon name="datasets">
            <ellipse cx="12" cy="5" rx="7" ry="3" />
            <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
          </SidebarIcon>
        ),
      },
    ],
  },
  {
    label: t("nav.groupAnalyze"),
    items: [
      {
        to: "/sql",
        label: t("nav.sql"),
        description: t("navDescription.sql"),
        icon: (
          <SidebarIcon name="sql">
            <path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z" />
            <path d="M4 6v12c0 1.7 3.6 3 8 3M20 6v5M14 16l2 2 4-4" />
          </SidebarIcon>
        ),
      },
      {
        to: "/analyses",
        label: t("nav.analyses"),
        description: t("navDescription.analyses"),
        icon: (
          <SidebarIcon name="analyses">
            <path d="M6 3h12v18l-6-4-6 4V3Z" />
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
    label: t("nav.groupOperate"),
    items: [
      {
        to: "/refresh-jobs",
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
      // Only for an administrator (#409). Hiding is a convenience; the Builder's 403 is the block.
      ...(isAdmin
        ? [
            {
              to: "/admin",
              label: t("nav.admin"),
              description: t("navDescription.admin"),
              icon: (
                <SidebarIcon name="admin">
                  <path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z" />
                  <path d="m9 12 2 2 4-4" />
                </SidebarIcon>
              ),
            },
          ]
        : []),
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
    // Brand v2 (#628 §9): only the active item is blue (a light blue tint with Brand Blue
    // text and icon); hover is a neutral tint and keeps the text colour.
    isActive
      ? "bg-sidebar-active text-sidebar-active-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-hover",
  ].join(" ");
}

/**
 * App shell component applied to all Studio pages.
 *
 * @returns Complete layout including sidebar, header, content slot, and global
 *          Assistant drawer.
 */
export function Layout() {
  const { t } = useTranslation();
  const isAdmin = useAdminStore((state) => state.status === "admin");
  const navGroups = buildNavGroups(t, isAdmin);
  const signupBlock = useSignupStatusStore((state) => state.block);
  const sessionRefusal = useSessionRefusalStore((state) => state.refusal);
  const signedInUser = useAuthStore((state) => state.userId ?? state.email);
  // The refusal was about the previous user's session.
  useEffect(() => {
    clearSessionRefusal();
  }, [signedInUser]);
  const signOutAfterRefusal = () => {
    clearSessionRefusal();
    if (useAuthStore.getState().oidcStatus === "authenticated") {
      // The one way out of an OIDC session: it clears this browser before leaving (#769).
      void signOutOfOidc();
      return;
    }
    useAuthStore.getState().clear();
  };
  const demoMode = !isRealBuilderEnabled();
  const closeMobileSidebar = useUIStore((state) => state.closeMobileSidebar);
  const isMobileSidebarOpen = useUIStore((state) => state.isMobileSidebarOpen);
  const isDesktopSidebarCollapsed = useUIStore((state) => state.isDesktopSidebarCollapsed);
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);
  const theme = useUIStore((state) => state.theme);
  const toggleMobileSidebar = useUIStore((state) => state.toggleMobileSidebar);
  const toggleDesktopSidebarCollapsed = useUIStore(
    (state) => state.toggleDesktopSidebarCollapsed,
  );
  const { pathname } = useLocation();
  const crumbs = crumbsFor(pathname, t);
  const searchDestinations: SearchDestination[] = [
    ...navGroups.flatMap((group) => group.items),
    { to: "/connections", label: t("nav.provider"), description: t("navDescription.provider") },
    { to: "/settings", label: t("nav.settings"), description: t("navDescription.settings") },
  ];

  useEffect(() => {
    void ensureAdminChecked();
  }, [pathname]);

  // The tab title names the page, in the current language (#662). It is set on the first
  // load as well, so a refreshed tab and a navigated one read the same.
  useEffect(() => {
    document.title = documentTitleFor(pathname, t);
  }, [pathname, t]);

  // After a client-side navigation, focus moves to the new page's heading so a screen
  // reader announces it and the next Tab starts in the page (#662). The first render is
  // a page load, not a navigation, and keeps the browser's own focus — so is a re-run of
  // this effect for the same path (React's development double-invoke).
  const mainRef = useRef<HTMLElement>(null);
  const focusedPathRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = focusedPathRef.current;
    focusedPathRef.current = pathname;
    if (previous === null || previous === pathname || !mainRef.current) return;
    return focusRouteTarget(mainRef.current);
  }, [pathname]);

  /** The skip link moves focus without changing the URL's hash (#660). */
  function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus();
  }

  useEffect(() => {
    document.documentElement.dataset.theme = getResolvedTheme(theme);
  }, [theme]);

  useEffect(() => {
    closeMobileSidebar();
  }, [closeMobileSidebar]);

  // Allow closing mobile sidebar with ESC (a11y, proposal §12.2).
  // Desktop collapse is not an overlay, so not an ESC target — this handler checks
  // mobile state only. Assistant drawer's ESC handling is its own responsibility when open
  // (see AssistantDrawer).
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
      {/* First in the tab order and hidden until focused: past the sidebar and topbar
          straight to the page (#660). */}
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        data-testid="skip-to-content"
        href="#main-content"
        onClick={skipToContent}
      >
        {t("layout.skipToContent")}
      </a>
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
            id="app-sidebar"
          className={[
            "fixed inset-y-0 left-0 z-40 flex w-sidebar shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-4 py-5 text-sidebar-foreground transition-all lg:static lg:translate-x-0",
            isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
            isDesktopSidebarCollapsed ? "lg:w-20 lg:px-2" : "lg:w-sidebar",
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-3 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <Link aria-label={t("layout.studioHome")} className="flex min-w-0 items-center" to="/">
                  {/* Light lockup on the light sidebar; the dark one only under the dark theme (#628). */}
                  <span className={["block", isDesktopSidebarCollapsed ? "lg:hidden" : ""].join(" ")}>
                    <BrandLogo className="w-[156px] max-w-full" />
                  </span>
                  <span className={["hidden", isDesktopSidebarCollapsed ? "lg:block" : ""].join(" ")}>
                    <BrandLogo className="h-8 w-8" variant="symbol" />
                  </span>
                </Link>
              </div>
             {/* Tagline belongs in Topbar (workspace/product context), so Sidebar keeps
                  only product name/logo (no duplication). */}
            </div>
            <button
              aria-label={t("layout.closeSidebar")}
              className="rounded-lg border border-sidebar-border p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar lg:hidden"
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
              className="hidden shrink-0 rounded-lg border border-sidebar-border p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar lg:inline-flex"
              onClick={toggleDesktopSidebarCollapsed}
              type="button"
            >
              {isDesktopSidebarCollapsed ? "»" : "«"}
            </button>
          </div>

          <nav aria-label={t("layout.mainNav")} className="mt-2 flex flex-1 flex-col gap-5">
            {navGroups.map((group) => (
              <div key={group.label ?? "home"}>
                {group.label ? (
                  <p
                    className={[
                      "px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted",
                      isDesktopSidebarCollapsed ? "lg:sr-only" : "",
                    ].join(" ")}
                  >
                    {group.label}
                  </p>
                ) : null}
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
                title={t("navDescription.provider")}
                to="/connections"
              >
                <SidebarIcon name="provider">
                  <path d="M4 21V7l8-4 8 4v14M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
                </SidebarIcon>
                <span className={isDesktopSidebarCollapsed ? "lg:sr-only" : undefined}>
                  {t("nav.provider")}
                </span>
              </NavLink>
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
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-0">
          <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  aria-controls="app-sidebar"
                  aria-expanded={isMobileSidebarOpen}
                  aria-label={t("layout.toggleSidebar")}
                  className="inline-flex rounded-lg border border-border bg-card p-2 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
                  onClick={toggleMobileSidebar}
                  type="button"
                >
                  ☰
                </button>
                {/* Where the user is, not the product's name — the sidebar logo says that (#423). */}
                <nav aria-label={t("layout.breadcrumb")} className="min-w-0">
                  <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                    {crumbs.map((crumb, index) => (
                      <li className="flex min-w-0 items-center gap-1.5" key={`${index}-${crumb.label}`}>
                        {index > 0 ? <span aria-hidden="true" className="text-muted-foreground">/</span> : null}
                        {crumb.to ? (
                          <Link className="truncate text-muted-foreground hover:text-foreground" to={crumb.to}>
                            {crumb.label}
                          </Link>
                        ) : (
                          <span aria-current="page" className="truncate font-semibold text-foreground">
                            {crumb.label}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </nav>
              </div>

              {/* Without min-w-0 here, this group keeps its min-content width, so the
                  left group's truncating breadcrumb shrinks instead and the buttons never
                  overlap it (390px width, UI audit #6-A). One AI entry point — Ask
                  KPubData — next to a search that is navigation only (#523). */}
              <div className="flex flex-1 items-center justify-end gap-2">
                {/* Mock data on every screen, not only at login (#672): Providers and Admin
                    otherwise read as a real deployment's state. shrink-0 keeps the badge whole
                    and lets the search shrink around it at phone width. */}
                {demoMode ? (
                  <span className="inline-flex shrink-0" data-testid="demo-indicator" title={t("layout.demoModeDesc")}>
                    <DemoBadge />
                    <span className="sr-only">{t("layout.demoModeDesc")}</span>
                  </span>
                ) : null}

                <CommandSearch destinations={searchDestinations} />

                <button
                  aria-haspopup="dialog"
                  aria-label={t("layout.openAssistant")}
                  data-tour="assistant-helper"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={openAssistantDrawer}
                  type="button"
                >
                  <span aria-hidden="true">✨</span>
                  <span className="hidden sm:inline">{t("layout.askKpubdata")}</span>
                </button>

                <AccountMenu />
              </div>
            </div>
          </header>

          <VersionMismatchBanner />

          {/* The one main landmark: pages render inside it and never add their own (#660). */}
          <main
            className="flex min-w-0 flex-1 flex-col focus:outline-none"
            id="main-content"
            ref={mainRef}
            tabIndex={-1}
          >
            {/* A sign-up the ledger holds back answers every request with 403 (#658); one
                explanation replaces the page rather than each page's generic error. */}
            {/* A session Builder keeps refusing after the token is renewed (#771) is
                explained once here too, and comes first: nothing else can be known. */}
            {sessionRefusal ? (
              <SessionRefusedNotice refusal={sessionRefusal} onSignOut={signOutAfterRefusal} />
            ) : signupBlock ? (
              <SignupStatusNotice block={signupBlock} />
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>

      <AssistantDrawer />
    </div>
  );
}
