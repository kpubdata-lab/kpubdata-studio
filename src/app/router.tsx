/**
 * File that defines Studio's React Router route tree based on React Router.
 *
 * Arranges workspace pages like Home, Build Draft, Validation, Preview, and Settings
 * under the common `Layout`.
 */
import { lazy, Suspense, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter } from "react-router-dom";
import { FeatureErrorBoundary, RouteErrorBoundary } from "@/app/ErrorBoundary";
import { Layout } from "@/app/Layout";
import { LegacyRedirect } from "@/app/legacyRedirect";
import { LoginGate } from "@/features/auth/LoginGate";
import { Skeleton } from "@/shared/ui";

/**
 * Per-route code splitting (#378).
 *
 * If all pages were statically imported, loading just the first screen would fetch
 * Monitoring·Reports·Assistant too (single chunk 1.14 MB). Switching each page to dynamic
 * import makes routes chunk boundaries.
 *
 * Pages use named export, so wrapped in `lazy`'s required default form.
 */
const AddDataPage = lazy(() =>
  import("@/pages/AddDataPage").then((m) => ({ default: m.AddDataPage })),
);
const ArtifactsPage = lazy(() =>
  import("@/pages/ArtifactsPage").then((m) => ({ default: m.ArtifactsPage })),
);
const BuildArtifactsPage = lazy(() =>
  import("@/pages/BuildArtifactsPage").then((m) => ({ default: m.BuildArtifactsPage })),
);
const BuildPublishPage = lazy(() =>
  import("@/pages/BuildPublishPage").then((m) => ({ default: m.BuildPublishPage })),
);
const BuildRunPage = lazy(() =>
  import("@/pages/BuildRunPage").then((m) => ({ default: m.BuildRunPage })),
);
const AdminPage = lazy(() =>
  import("@/pages/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const SqlWorkspacePage = lazy(() =>
  import("@/pages/SqlWorkspacePage").then((m) => ({ default: m.SqlWorkspacePage })),
);
const BuildsPage = lazy(() =>
  import("@/pages/BuildsPage").then((m) => ({ default: m.BuildsPage })),
);
const DatasetCatalogPage = lazy(() =>
  import("@/pages/DatasetCatalogPage").then((m) => ({ default: m.DatasetCatalogPage })),
);
const DatasetDetailPage = lazy(() =>
  import("@/pages/DatasetDetailPage").then((m) => ({ default: m.DatasetDetailPage })),
);
const DiscoverPage = lazy(() =>
  import("@/pages/DiscoverPage").then((m) => ({ default: m.DiscoverPage })),
);
const HomePage = lazy(() =>
  import("@/pages/HomePage").then((m) => ({ default: m.HomePage })),
);
const AssistantPage = lazy(() =>
  import("@/pages/AssistantPage").then((m) => ({ default: m.AssistantPage })),
);
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const MonitoringPage = lazy(() =>
  import("@/pages/MonitoringPage").then((m) => ({ default: m.MonitoringPage })),
);
const NewBuildPage = lazy(() =>
  import("@/pages/NewBuildPage").then((m) => ({ default: m.NewBuildPage })),
);
const PreviewPage = lazy(() =>
  import("@/pages/PreviewPage").then((m) => ({ default: m.PreviewPage })),
);
const ProviderPage = lazy(() =>
  import("@/pages/ProviderPage").then((m) => ({ default: m.ProviderPage })),
);
const QualityPage = lazy(() =>
  import("@/pages/QualityPage").then((m) => ({ default: m.QualityPage })),
);
const ReportEditorPage = lazy(() =>
  import("@/pages/ReportEditorPage").then((m) => ({ default: m.ReportEditorPage })),
);
const ReportsPage = lazy(() =>
  import("@/pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const SignupPage = lazy(() =>
  import("@/pages/SignupPage").then((m) => ({ default: m.SignupPage })),
);
const ValidatePage = lazy(() =>
  import("@/pages/ValidatePage").then((m) => ({ default: m.ValidatePage })),
);
const WorkspacePage = lazy(() =>
  import("@/pages/WorkspacePage").then((m) => ({ default: m.WorkspacePage })),
);

/**
 * Placeholder shown while page chunk arrives.
 *
 * Skeleton itself is aria-hidden, so screen readers get guidance text with `role="status"`
 * instead of seeing blank space with no announcement — ensures loading state is communicated.
 */
function PageFallback() {
  const { t } = useTranslation();
  return (
    <main
      role="status"
      aria-busy="true"
      className="flex flex-1 flex-col gap-4 px-5 py-8 sm:px-8 lg:px-10 lg:py-10"
    >
      <span className="sr-only">{t("router.loading")}</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-64 w-full" />
    </main>
  );
}

/** Wraps page element in Suspense boundary — shows fallback until chunk arrives. */
function withSuspense(element: ReactElement): ReactElement {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

/**
 * Wraps page element in feature-scoped ErrorBoundary (#97).
 *
 * Prevents one feature's render error from bubbling to global fallback and blanking entire app.
 * Each route element wrapped in a boundary that falls back only that area. Operates inside
 * Layout's `<Outlet />`, so sidebar/header stays intact.
 *
 * @param feature - Feature name to show in fallback.
 * @param element - Page element to protect.
 * @returns Element wrapped in boundary.
 */
/** `feature` is an i18n key, not a screen name (#350) — fallback interprets it in current language. */
function withFeatureBoundary(feature: string, element: ReactElement): ReactElement {
  // Place Suspense *inside* boundary — network failure (connection dropped, etc.) is also caught
  // by fallback, so feature area doesn't blank out the entire screen.
  return <FeatureErrorBoundary feature={feature}>{withSuspense(element)}</FeatureErrorBoundary>;
}

/**
 * Global router connecting browser URLs to Studio page components.
 *
 * @returns Browser router instance with rendering rules per route.
 */
export const router = createBrowserRouter([
    // Login/Signup (#263) is a standalone screen outside App Shell (sidebar/header), so placed
    // as top-level sibling route instead of under Layout's children — pre-login state has no workspace shell yet.
    {
      path: "/login",
      element: withSuspense(<LoginPage />),
    },
    {
      path: "/signup",
      element: withSuspense(<SignupPage />),
    },
    {
      path: "/",
      element: <LoginGate><Layout /></LoginGate>,
      errorElement: <RouteErrorBoundary />,
      children: [
      {
        index: true,
        element: withFeatureBoundary("router.features.home", <HomePage />),
      },
       // New IA (#247) WORKSPACE group. Discover implemented in #249. Workspace is currently
       // placeholder; will be replaced with actual screen in #260.
      {
        path: "discover",
        element: withFeatureBoundary("router.features.Discover", <DiscoverPage />),
      },
      {
        path: "workspace",
        element: withFeatureBoundary("router.features.Workspace", <WorkspacePage />),
      },
       // New IA DATA group. Add Data/Dataset Catalog/Quality implemented in #250/#253/#254.
      {
        path: "add",
        element: withFeatureBoundary("router.features.AddData", <AddDataPage />),
      },
      {
        path: "tables",
        element: withFeatureBoundary("router.features.DatasetCatalog", <DatasetCatalogPage />),
      },
      {
        path: "tables/:datasetId",
        element: withFeatureBoundary("router.features.datasetDetail", <DatasetDetailPage />),
      },
      {
        path: "refresh-jobs",
        element: withFeatureBoundary("router.features.builds", <BuildsPage />),
      },
      {
        path: "refresh-jobs/new",
        element: withFeatureBoundary("router.features.newBuild", <NewBuildPage />),
      },
      {
        path: "quality",
        element: withFeatureBoundary("router.features.Quality", <QualityPage />),
      },
       // Build-unit-centric routes (§3.3 proposal): detail → edit/run/artifacts/publish.
       // Legacy deep link (#255 §5): /builds/:buildId also uses same master-detail (BuildsPage)
       // Opens to canonical form (/builds?run=) for same context.
      {
        path: "refresh-jobs/:buildId",
        element: withFeatureBoundary("router.features.buildDetail", <BuildsPage />),
      },
      {
         // Edit reuses same editor as New Build.
        path: "refresh-jobs/:buildId/edit",
        element: withFeatureBoundary("router.features.buildEdit", <NewBuildPage />),
      },
      {
        path: "refresh-jobs/:buildId/run",
        element: withFeatureBoundary("router.features.buildRun", <BuildRunPage />),
      },
      {
        path: "refresh-jobs/:buildId/artifacts",
        element: withFeatureBoundary("router.features.artifacts", <BuildArtifactsPage />),
      },
      {
        path: "refresh-jobs/:buildId/publish",
        element: withFeatureBoundary("router.features.publish", <BuildPublishPage />),
      },
       // New IA AI group (actual feature implementation in #256). Global Assistant drawer
       // mounted separately at Layout level in `src/features/assistant/AssistantDrawer.tsx`.
      {
        path: "assistant",
        element: withFeatureBoundary("router.features.Assistant", <AssistantPage />),
      },
      {
        path: "sql",
        element: withFeatureBoundary("router.features.sql", <SqlWorkspacePage />),
      },
      {
        path: "reports",
        element: withFeatureBoundary("router.features.Reports", <ReportsPage />),
      },
      {
        path: "reports/:reportId",
        element: withFeatureBoundary("router.features.reportEditor", <ReportEditorPage />),
      },
       // New IA SYSTEM group (actual feature implementation in #259/#264).
      {
        path: "connections",
        element: withFeatureBoundary("router.features.Provider", <ProviderPage />),
      },
      {
        path: "admin",
        element: withFeatureBoundary("router.features.admin", <AdminPage />),
      },
      {
        path: "monitoring",
        element: withFeatureBoundary("router.features.Monitoring", <MonitoringPage />),
      },
       // Legacy standalone route: removed from nav but kept for deep link compatibility (#247 decision:
       // Don't redirect to new IA; keep as-is — Validate/Preview/Artifacts planned for integration as
       // New Build Wizard panels; until then, existing screens act as fallback).
      {
        path: "validate",
        element: withFeatureBoundary("router.features.validate", <ValidatePage />),
      },
      {
        path: "preview",
        element: withFeatureBoundary("router.features.preview", <PreviewPage />),
      },
      {
        path: "artifacts",
        element: withFeatureBoundary("router.features.artifacts", <ArtifactsPage />),
      },
      {
        path: "settings",
        element: withFeatureBoundary("router.features.settings", <SettingsPage />),
      },
      // Old build-console URL (#423) — redirects with path, query and hash intact.
      { path: "datasets/*", element: <LegacyRedirect /> },
      // Old build-console URL (#423) — redirects with path, query and hash intact.
      { path: "builds/*", element: <LegacyRedirect /> },
      // Old build-console URL (#423) — redirects with path, query and hash intact.
      { path: "provider/*", element: <LegacyRedirect /> },
    ],
  },
  ],
  {
    // GitHub Pages subfolder (/kpubdata-studio/) routing works when base is set to basename.
    basename: import.meta.env.BASE_URL.replace(/\/+$/, "") || "/",
  },
);
