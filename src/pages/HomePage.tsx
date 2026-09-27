/**
 * Studio home dashboard screen — branches by new user / existing user state.
 *
 * Issue #248: Implement Home with new user and existing user state branching.
 *
 * New user detection is based on dataset/build existence:
 * - New user: Welcome message, Kubi natural language hero (reuses topbar KubiSearchInput seed flow),
 *   public data search, direct data import
 * - Existing user: Actual KPIs (DATASETS, BUILD SUCCESS, VALIDATION WARN, RUNNING), recent datasets,
 *   recent Build stage summarization, quality warnings/failed Builds
 *
 * Phase 2 UI polish: Removed "example datasets coming soon" placeholder section — it gave the
 * impression of incomplete service without actual example datasets. The same CTA is now handled
 * by the "public data search → /discover" card.
 */
import { useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAssistConfig } from "@/features/assistant/config";
import { listBuilds } from "@/features/runs/api";
import { getSuggestedQuestions } from "@/features/kubi/suggestedQuestions";
import { useKubiStore } from "@/features/kubi/useKubiSession";
import { FirstRunTour, resetFirstRunTour } from "@/features/onboarding/FirstRunTour";
import { useAuthStore } from "@/features/auth/store";
import { builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { BuildQualityResponse, QualityCheckResult } from "@/shared/lib/builderApi.schema";
import type { BuildListItem } from "@/shared/lib/types";
import {
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
  HelpTooltip,
} from "@/shared/ui";

interface DashboardStats {
  datasetCount: number | null;
  buildSuccess: number | null;
  qualityWarn: number | null;
  running: number | null;
}

/**
 * Each KPI aggregate is an independent API boundary — if one fails, other KPI values and
 * Recent Builds remain unaffected. "loading" renders as skeleton, "unavailable" renders as
 * "verification unavailable" (no fabricated numbers).
 */
type KpiPhase = "loading" | "ready" | "unavailable";

interface KpiPhases {
  /** DATASETS — authoritative `total` from GET /datasets (Builder 1.22.0). */
  datasets: KpiPhase;
  /** SUCCEEDED (24H) + RUNNING — GET /monitoring/* shared boundary. */
  monitoring: KpiPhase;
  /** QUALITY WARN (24H) — GET /quality/summary (Builder 1.22.0). */
  quality: KpiPhase;
}

/**
 * Query only authoritative dataset total for DATASETS KPI + new user detection independently —
 * don't touch monitoring/quality boundaries.
 *
 * Builder 1.21.0 and below don't send `total`, so when that happens, don't substitute with
 * items.length/limit; instead mark as "verification unavailable" (kpi.datasets="unavailable",
 * datasetCount=null). Callers won't misinterpret this state as "no datasets".
 */
function loadDatasetTotal(
  isActive: () => boolean,
  setStats: Dispatch<SetStateAction<DashboardStats>>,
  setKpi: Dispatch<SetStateAction<KpiPhases>>,
): void {
  builderApi
    .listDatasets(1)
    .then((res) => {
      if (!isActive()) return;
      setStats((prev) => ({ ...prev, datasetCount: res.total ?? null }));
      setKpi((prev) => ({ ...prev, datasets: res.total === undefined ? "unavailable" : "ready" }));
    })
    .catch(() => {
      if (!isActive()) return;
      setStats((prev) => ({ ...prev, datasetCount: null }));
      setKpi((prev) => ({ ...prev, datasets: "unavailable" }));
    });
}

/**
 * In real mode, load all 3 Home KPI boundaries independently.
 *
 * The three requests never block each other or already-committed Recent Builds.
 * If one aggregate fails/is unsupported, only that KPI becomes "verification unavailable"
 * without fabricating values.
 */
function loadRealKpis(
  isActive: () => boolean,
  setStats: Dispatch<SetStateAction<DashboardStats>>,
  setKpi: Dispatch<SetStateAction<KpiPhases>>,
): void {
  // (1) DATASETS — dataset total.
  loadDatasetTotal(isActive, setStats, setKpi);

   // (2) SUCCEEDED (24H) + RUNNING — monitoring. Each endpoint failure only nulls its value.
  void Promise.all([
    builderApi.getMonitoringBuilds().catch(() => null),
    builderApi.getMonitoringSummary().catch(() => null),
  ]).then(([monitoring, summary]) => {
    if (!isActive()) return;
    const monitoredSuccess =
      monitoring?.availability === "available"
        ? monitoring.buckets.reduce((sum, bucket) => sum + bucket.success, 0)
        : null;
    setStats((prev) => ({
      ...prev,
      buildSuccess: monitoredSuccess,
      // GET /builds contract provides only terminal summary, so don't interpret as active count.
      running: summary?.queue.running ?? null,
    }));
    setKpi((prev) => ({ ...prev, monitoring: "ready" }));
  });

   // (3) QUALITY WARN (24H) — quality summary. Unsupported (Builder 1.21.0 below → 404) / failure → "verification unavailable".
  builderApi
    .getQualitySummary()
    .then((res) => {
      if (!isActive()) return;
      setStats((prev) => ({
        ...prev,
        qualityWarn: res.availability === "available" ? res.warn_runs : null,
      }));
      setKpi((prev) => ({ ...prev, quality: "ready" }));
    })
    .catch(() => {
      if (!isActive()) return;
      setStats((prev) => ({ ...prev, qualityWarn: null }));
      setKpi((prev) => ({ ...prev, quality: "unavailable" }));
    });
}

/**
 * Determine whether user is new.
 *
 * New user is confirmed only when "no builds AND no datasets" is actually verified. Empty build
 * list alone is insufficient — can't distinguish from users who have datasets but haven't run builds yet.
 * In real mode, also check authoritative `total` from Builder GET /datasets (1.22.0); if total is
 * unavailable (old Builder / 404·5xx), don't guess new; show existing dashboard (DATASETS only "verification unavailable").
 */
export function HomePage() {
  const realBuilder = isRealBuilderEnabled();
  const userId = useAuthStore((state) => state.userId);
  const [builds, setBuilds] = useState<BuildListItem[]>([]);
  const [buildsState, setBuildsState] = useState<"loading" | "error" | "success">("loading");
  const [stats, setStats] = useState<DashboardStats>({
    datasetCount: null,
    buildSuccess: null,
    qualityWarn: null,
    running: null,
  });
  const [kpi, setKpi] = useState<KpiPhases>({
    datasets: "loading",
    monitoring: "loading",
    quality: "loading",
  });
  const [recentQuality, setRecentQuality] = useState<RecentQualityState>({
    phase: "loading",
    alerts: [],
  });

  useEffect(() => {
    let active = true;

    // Real Builder's aggregate is an independent API boundary from Recent Builds. Starts immediately
    // regardless of whether /builds succeeds or returns empty list.
    if (realBuilder) {
      loadRealKpis(() => active, setStats, setKpi);
    }

     // Recent Builds is completely independent from KPI requests — commit immediately on receive,
     // and on failure, mark only that section as error regardless of KPI state.
    listBuilds()
      .then((list) => {
        if (!active) return;
        setBuilds(list);
        setBuildsState("success");

         // Real mode aggregate was already independently requested at effect start. Empty build is
         // only one criterion for new user detection; doesn't make monitoring/quality unavailable.
        if (list.length === 0) {
          if (!realBuilder) {
            setKpi({ datasets: "unavailable", monitoring: "unavailable", quality: "unavailable" });
          }
          return;
        }

        if (realBuilder) {
          return;
        }

         // Mock/demo: keep existing demo meaning — compute directly from mock list. Already in mock
         // mode, so no path to substitute real failures with mock numbers.
        const succeeded = list.filter((b) => b.status === "succeeded").length;
        const running = list.filter(
          (b) => b.status === "running" || b.status === "queued",
        ).length;
        setStats({ datasetCount: null, buildSuccess: succeeded, qualityWarn: null, running });
        setKpi({ datasets: "unavailable", monitoring: "ready", quality: "unavailable" });
      })
      .catch(() => {
        if (!active) return;
        setBuildsState("error");
       // Real aggregate continues independently from /builds error. Mock/demo keeps existing
       // behavior to avoid displaying KPI without grounds.
        if (!realBuilder) {
          setKpi({ datasets: "unavailable", monitoring: "unavailable", quality: "unavailable" });
        }
      });

    return () => {
      active = false;
    };
  }, [realBuilder]);

  const recentBuilds = useMemo(
    () =>
      [...builds]
        .sort((a, b) => {
          const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
          const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 5),
    [builds],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (buildsState === "loading") {
      setRecentQuality({ phase: "loading", alerts: [] });
      return () => controller.abort();
    }
    if (!realBuilder || buildsState === "error" || recentBuilds.length === 0) {
      setRecentQuality({ phase: "unavailable", alerts: [] });
      return () => controller.abort();
    }

       // Quality results are queried from manifest (GET /builds/{run_id}/quality). Only successfully
       // completed Runs have manifest, so calling getBuildQuality on queued/running/cancelled Runs
       // always returns 404 — query only canonical succeeded Runs.
    const qualityRuns = recentBuilds.filter((run) => run.status === "succeeded");
    if (qualityRuns.length === 0) {
      setRecentQuality({ phase: "ready", alerts: [], incomplete: false });
      return () => controller.abort();
    }

    setRecentQuality({ phase: "loading", alerts: [] });
    void Promise.allSettled(
      qualityRuns.map((run) => builderApi.getBuildQuality(run.id, controller.signal)),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const alerts: QualityAlert[] = [];
      let incomplete = false;
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          incomplete = true;
          return;
        }
        if (result.value.availability !== "available") incomplete = true;
        alerts.push(...qualityAlertsForRun(qualityRuns[index], result.value));
      });
      setRecentQuality({ phase: "ready", alerts: alerts.slice(0, 5), incomplete });
    });

    return () => controller.abort();
  }, [buildsState, realBuilder, recentBuilds]);

  // Real mode: confirm new user only when ALL conditions met: 0 builds + dataset total query
  // success (kpi.datasets="ready") + total===0. If total is unavailable, don't guess with only
  // empty build. Mock/demo mode has no dataset aggregate authority, so keep existing build-based decision.
  const datasetsConfirmedEmpty = kpi.datasets === "ready" && stats.datasetCount === 0;
  const isNew =
    buildsState === "success" &&
    builds.length === 0 &&
    (realBuilder ? datasetsConfirmedEmpty : true);

  return (
    <main className="flex flex-1 flex-col gap-8 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      {isNew ? (
        <EmptyWorkspaceHome userId={userId} />
      ) : (
        <ExistingUserHome
          userId={userId}
          stats={stats}
          recentBuilds={recentBuilds}
          buildsState={buildsState}
          kpi={kpi}
          recentQuality={recentQuality}
        />
      )}
    </main>
  );
}

function EmptyWorkspaceHome({ userId }: { userId: string | null }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        eyebrow={t("home.hero.eyebrow")}
        title={t("home.hero.title")}
        description={t("home.hero.desc")}
        actions={<Button variant="ghost" size="sm" onClick={resetFirstRunTour}>{t("home.hero.tour")}</Button>}
      />

      <WorkflowStrip />

      <section data-tour="start-actions" className="grid gap-6 lg:grid-cols-2">
        <Card variant="elevated" className="flex flex-col items-center justify-center p-10 text-center">
          <h2 className="text-xl font-semibold tracking-tight">{t("home.explore.title")}</h2>
          <p className="mt-3 text-muted-foreground">
            {t("home.explore.desc")}
          </p>
          <LinkButton className="mt-6" variant="secondary" to="/discover">
            {t("home.explore.cta")}
          </LinkButton>
        </Card>

        <Card variant="elevated" className="flex flex-col items-center justify-center p-10 text-center">
          <h2 className="text-xl font-semibold tracking-tight">{t("home.addData.title")}</h2>
          <p className="mt-3 text-muted-foreground">
            {t("home.addData.desc")}
          </p>
          <LinkButton className="mt-6" variant="secondary" to="/add">
            {t("home.addData.cta")}
          </LinkButton>
        </Card>
      </section>
      <div data-tour="kubi-helper"><KubiHero /></div>
      {userId ? <FirstRunTour userId={userId} /> : null}
    </>
  );
}

interface QualityAlert {
  runId: string;
  runTitle: string;
  status: "warn" | "fail";
  detail: string;
}

type RecentQualityState =
  | { phase: "loading"; alerts: [] }
  | { phase: "ready"; alerts: QualityAlert[]; incomplete: boolean }
  | { phase: "unavailable"; alerts: [] };

function qualityAlertsForRun(
  run: BuildListItem,
  response: BuildQualityResponse,
): QualityAlert[] {
  const runTitle = run.title ?? run.id;
  return Object.values(response.quality_results)
    .flat()
    .filter((result): result is QualityCheckResult & { status: "warn" | "fail" } =>
      result.status === "warn" || result.status === "fail",
    )
    .map((result) => ({
      runId: run.id,
      runTitle,
      status: result.status,
      detail: result.detail ?? [result.rule, result.column].filter(Boolean).join(" · "),
    }));
}

/** STEP number only is constant — labels follow language switching, so interpret at render time. */
const WORKFLOW_STEP_NUMBERS = ["1", "2", "3", "4"] as const;

/**
 * Overall task flow description for Home. Not a clickable action card but workflow overview, so
 * don't add hover/button feel (shadow emphasis, cursor-pointer) or card-level navigation —
 * actual work in each STEP happens below in "search public data"/"import data directly" cards
 * and sidebar.
 */
function WorkflowStrip() {
  const { t } = useTranslation();
  return (
    <section data-tour="workflow" aria-labelledby="workflow-heading" className="space-y-3">
      <div>
        <h2 id="workflow-heading" className="text-sm font-semibold text-foreground">{t("home.steps.heading")}</h2>
        <p className="text-xs text-muted-foreground">{t("home.steps.note")}</p>
      </div>
      <ol className="grid items-stretch gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        {WORKFLOW_STEP_NUMBERS.map((number, index) => (
          <li key={number} className="contents">
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs font-semibold text-accent-subtle-foreground">STEP {number}</span>
              <h3 className="mt-2 text-sm font-semibold">{t(`home.steps.${number}`)}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(`home.steps.${number}d`)}</p>
            </div>
            {index < WORKFLOW_STEP_NUMBERS.length - 1 ? (
              <span aria-hidden="true" className="hidden items-center justify-center text-muted-foreground xl:flex">→</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Home's Kubi natural language hero (#Phase2 UI polish, #S-kubi-suggest).
 *
 * Full Kubi task starts at `/kubi` page (not drawer). Reuse only existing seed mechanism
 * (`useKubiStore().seedQuestion`), don't create new assistant system — when `/kubi` mounts,
 * `useKubiSession` consumes pendingSeed to generate answer. Don't put question in URL query
 * (pass via seed store only).
 *
 * `ask()` (useKubiSession.ts) runs immediately on seed receive and creates `no_key` error turn
 * if API Key not configured. To avoid unwanted error turn, only keep seed when `isConfigured`,
 * otherwise navigate to `/kubi` without seed and show API Key configuration guide on that screen.
 */
function KubiHero() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const seedQuestion = useKubiStore((state) => state.seedQuestion);
  const { isConfigured } = useAssistConfig();
  const startQuestions = getSuggestedQuestions({ context: { page: "home" }, turns: [] });

  function ask(question: string) {
    const trimmed = question.trim();
    if (trimmed && isConfigured) seedQuestion(trimmed);
    navigate("/kubi");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(query);
    setQuery("");
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold tracking-tight">{t("home.kubi.title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("home.kubi.desc")}
      </p>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="home-kubi-hero">
          {t("home.kubi.try")}
        </label>
        <input
          className="h-11 flex-1 rounded-lg border border-input bg-card px-4 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id="home-kubi-hero"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("home.kubi.placeholder")}
          type="search"
          value={query}
        />
        <Button type="submit">{t("home.kubi.cta")}</Button>
      </form>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {startQuestions.map((question) => (
          <button
            key={question}
            type="button"
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
            onClick={() => ask(question)}
          >
            {question}
          </button>
        ))}
      </div>
      {!isConfigured ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("home.kubi.noKey")}
        </p>
      ) : null}
    </Card>
  );
}

function ExistingUserHome({
  userId,
  stats,
  recentBuilds,
  buildsState,
  kpi,
  recentQuality,
}: {
  userId: string | null;
  stats: DashboardStats;
  recentBuilds: BuildListItem[];
  buildsState: "loading" | "error" | "success";
  kpi: KpiPhases;
  recentQuality: RecentQualityState;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        eyebrow={t("home.dashboard.eyebrow")}
        title={t("home.dashboard.title")}
        description={t("home.dashboard.desc")}
        actions={userId ? <Button variant="secondary" onClick={() => resetFirstRunTour(userId)}>{t("home.dashboard.guide")}</Button> : undefined}
      />

      <section data-tour="dashboard-overview"><KpiCards stats={stats} kpi={kpi} /></section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div data-tour="dashboard-builds"><RecentBuildsSection
          recentBuilds={recentBuilds}
          loading={buildsState === "loading"}
          apiState={buildsState}
        /></div>
        <div data-tour="dashboard-quality"><QualitySection state={recentQuality} /></div>
      </section>
      {userId ? <FirstRunTour userId={userId} autoStart={false} variant="dashboard" /> : null}
    </>
  );
}

/**
 * 4 KPI columns. Each looks only at its own aggregate boundary's phase — if one fails,
 * other columns keep normal values without covering entire row in error. Null values
 * render as "verification unavailable" in KpiCard (no fabricated numbers).
 */
/** Date display follows screen language. */
function dateLocale(): string {
  return i18n.language?.startsWith("en") ? "en-US" : "ko-KR";
}

function KpiCards({ stats, kpi }: { stats: DashboardStats; kpi: KpiPhases }) {
  const { t } = useTranslation();
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="DATASETS" help={t("home.kpi.datasets")} value={stats.datasetCount} loading={kpi.datasets === "loading"} />
      <KpiCard
        label="SUCCEEDED (24H)"
        help={t("home.kpi.succeeded")}
        value={stats.buildSuccess}
        loading={kpi.monitoring === "loading"}
        variant="success"
      />
      <KpiCard
        label="QUALITY WARN (24H)"
        help={t("home.kpi.qualityWarn")}
        value={stats.qualityWarn}
        loading={kpi.quality === "loading"}
        variant="error"
      />
      <KpiCard label="RUNNING" help={t("home.kpi.running")} value={stats.running} loading={kpi.monitoring === "loading"} />
    </section>
  );
}

function KpiCard({
  label,
  help,
  value,
  loading,
  variant = "default",
}: {
  label: string;
  help: string;
  value: number | null;
  loading: boolean;
  variant?: "default" | "success" | "error";
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Card>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">{label}<HelpTooltip content={help} label={t("home.kpi.definitionLabel", { label })} /></span>
        <Skeleton className="mt-2 h-8 w-16" />
      </Card>
    );
  }

  const colorClass = variant === "success" ? "text-emerald-600 dark:text-emerald-400" :
                     variant === "error" ? "text-red-600 dark:text-red-400" :
                     "text-foreground";

  return (
    <Card className="flex items-center justify-between">
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">{label}<HelpTooltip content={help} label={t("home.kpi.definitionLabel", { label })} /></span>
      <span className={`text-2xl font-semibold tracking-tight ${colorClass}`}>
        {value === null ? t("home.kpi.unavailable") : value}
      </span>
    </Card>
  );
}

function RecentBuildsSection({
  recentBuilds,
  loading,
  apiState,
}: {
  recentBuilds: BuildListItem[];
  loading: boolean;
  apiState: "loading" | "error" | "success";
}) {
  const { t } = useTranslation();
  return (
    <section>
      <PageHeader eyebrow={t("home.recent.eyebrow")} title={t("home.recent.title")} className="mb-4" />
      <Card className="p-0">
        {loading ? (
          <div className="px-6 py-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-[1.4fr_0.7fr_0.9fr_0.6fr] items-center gap-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-8 w-12 ml-auto" />
              </div>
            ))}
          </div>
        ) : apiState === "error" ? (
          <EmptyState
            title={t("home.recent.errorTitle")}
            description={t("home.recent.errorDesc")}
          />
        ) : recentBuilds.length === 0 ? (
          <EmptyState
            title={t("home.recent.emptyTitle")}
            description={t("home.recent.emptyDesc")}
            actionLabel={t("home.recent.emptyCta")}
            actionHref="/builds/new"
          />
        ) : (
          <ul>
            {recentBuilds.map((run) => (
              <li
                key={run.id}
                className="grid grid-cols-[1.4fr_0.7fr_0.9fr_0.6fr] items-center gap-4 border-b border-border px-6 py-3 text-sm last:border-0"
              >
                <span className="font-medium">{run.title ?? run.id}</span>
                <span className="capitalize text-muted-foreground">{run.status}</span>
                <span className="text-muted-foreground">
                  {run.startedAt ? new Date(run.startedAt).toLocaleString(dateLocale()) : "—"}
                </span>
                <span className="text-right">
                  <LinkButton variant="secondary" size="sm" to={`/builds/${run.id}`}>
                    {t("home.recent.view")}
                  </LinkButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function QualitySection({ state }: { state: RecentQualityState }) {
  const { t } = useTranslation();
  return (
    <section>
      <PageHeader eyebrow={t("home.quality.eyebrow")} title={t("home.quality.title")} className="mb-4" />
      <Card className="p-0">
        {state.phase === "loading" ? (
          <div className="space-y-3 px-6 py-5">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-8 w-full" />)}
          </div>
        ) : state.phase === "unavailable" || (state.incomplete && state.alerts.length === 0) ? (
          <EmptyState
            title={t("home.quality.unavailableTitle")}
            description={t("home.quality.unavailableDesc")}
          />
        ) : state.alerts.length === 0 ? (
          <EmptyState
            title={t("home.quality.emptyTitle")}
            description={t("home.quality.emptyDesc")}
          />
        ) : (
          <div>
            <div className="px-6 py-4">
              <h3 className="font-semibold">{t("home.quality.needsCheck")}</h3>
              {state.incomplete ? (
                <p className="mt-1 text-xs text-muted-foreground">{t("home.quality.incomplete")}</p>
              ) : null}
            </div>
            <ul className="border-t border-border">
              {state.alerts.map((alert, index) => (
                <li key={`${alert.runId}:${alert.detail}:${index}`} className="border-b border-border last:border-0">
                  {/* In WARN/FAIL items, link to that Run's Quality context (/builds/:runId, same as ?run=
                      canonical form) — same path already used by BuildsPage and Recent Builds. */}
                  <Link to={`/builds/${encodeURIComponent(alert.runId)}`} className="block px-6 py-3 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-medium">{alert.runTitle}</span>
                      <span className={alert.status === "fail" ? "font-semibold text-red-600 dark:text-red-400" : "font-semibold text-amber-700 dark:text-amber-400"}>
                        {alert.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{alert.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="border-t border-border px-6 py-4">
          <LinkButton variant="secondary" size="sm" to="/quality">{t("home.quality.center")}</LinkButton>
        </div>
      </Card>
    </section>
  );
}
