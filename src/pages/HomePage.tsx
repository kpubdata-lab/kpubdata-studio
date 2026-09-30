/**
 * Home (#527): what needs attention and what changed, not an operations dashboard.
 *
 * Left: tables that need attention (the section is left out when there are none) and the
 * most recent snapshots, with the run that made each only as a secondary column. Right:
 * recent saved analyses and connection problems. Every item is one click from its table
 * or analysis. There are no KPI cards, no workflow strip and no tour over the screen.
 *
 * A deployment without a warehouse has no snapshots or saved analyses; it keeps the recent
 * runs list and says why in one line. Someone with no tables and no runs yet gets the two
 * ways to start: find a source in the Catalog, or make a table from a file.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { listDatasets } from "@/features/datasets/api";
import { AxisValue } from "@/features/datasets/components/StatusAxes";
import { formatDateTime } from "@/features/datasets/model";
import {
  attentionAxes,
  connectionProblems,
  loadRecentSnapshots,
  splitTableName,
  type RecentSnapshot,
} from "@/features/home/homeData";
import { listBuilds } from "@/features/runs/api";
import { detectWarehouse } from "@/features/sql/warehouse";
import { builderApi, type DatasetSummary, type SavedAnalysis } from "@/shared/lib/builderApi";
import type { BuildListItem } from "@/shared/lib/types";
import { Card, LinkButton, PageHeader, Skeleton } from "@/shared/ui";
import { MissingStatus } from "@/shared/ui/StatusState";

type Loadable<T> = { status: "loading" } | { status: "loaded"; data: T } | { status: "error" };

const ATTENTION_LIMIT = 6;
const RECENT_LIMIT = 5;

function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (live) setState({ status: "loaded", data });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
      controller.abort();
    };
    // Each loader is fixed for the page's lifetime; only `enabled` starts it.
  }, [enabled]);
  return state;
}

export function HomePage() {
  const { t } = useTranslation();
  const datasets = useLoad((signal) => listDatasets(50, signal));
  const builds = useLoad(() => listBuilds());
  const warehouse = useLoad((signal) => detectWarehouse(signal));
  const tables = warehouse.status === "loaded" && warehouse.data.status === "available" ? warehouse.data.tables : null;
  const hasWarehouse = tables !== null;
  const snapshots = useLoad((signal) => loadRecentSnapshots(tables ?? [], RECENT_LIMIT, signal), hasWarehouse);
  const analyses = useLoad((signal) => builderApi.listAnalyses(signal), hasWarehouse);

  const isNew =
    datasets.status === "loaded" && datasets.data.length === 0 && builds.status === "loaded" && builds.data.length === 0;

  if (isNew) return <StartHome />;

  const warehouseKnown = warehouse.status !== "loading";
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader
        title={t("home.dashboard.title")}
        description={t("home.dashboard.desc")}
        actions={<LinkButton to="/sql">{t("home.newQuery")}</LinkButton>}
      />
      {warehouseKnown && !hasWarehouse ? <p className="text-xs text-muted-foreground">{t("home.noWarehouse")}</p> : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <AttentionTables datasets={datasets} />
          {!warehouseKnown ? (
            <SectionSkeleton title={t("home.snapshots.title")} />
          ) : hasWarehouse ? (
            <RecentSnapshots state={snapshots} />
          ) : (
            <RecentRuns state={builds} />
          )}
        </div>
        <div className="min-w-0 space-y-5">
          {hasWarehouse ? <RecentAnalyses state={analyses} /> : null}
          <ConnectionAttention datasets={datasets} />
        </div>
      </div>
    </main>
  );
}

/** First visit: the two direct ways to a first table. */
function StartHome() {
  const { t } = useTranslation();
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader title={t("home.hero.title")} description={t("home.hero.desc")} />
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col items-start gap-2">
          <h2 className="text-sm font-semibold">{t("home.explore.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("home.explore.desc")}</p>
          <LinkButton className="mt-2" to="/discover">
            {t("home.explore.cta")}
          </LinkButton>
        </Card>
        <Card className="flex flex-col items-start gap-2">
          <h2 className="text-sm font-semibold">{t("home.addData.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("home.addData.desc")}</p>
          <LinkButton className="mt-2" variant="secondary" to="/add">
            {t("home.addData.cta")}
          </LinkButton>
        </Card>
      </section>
    </main>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <Card className="min-w-0 overflow-hidden p-0">{children}</Card>
    </section>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <Section title={title}>
      <div className="space-y-2 p-4">
        {[1, 2, 3].map((item) => (
          <Skeleton className="h-6 w-full" key={item} />
        ))}
      </div>
    </Section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

/** Only tables with a Stale, Degraded, Partial, Failed or Access state; left out when there are none. */
function AttentionTables({ datasets }: { datasets: Loadable<DatasetSummary[]> }) {
  const { t } = useTranslation();
  if (datasets.status === "loading") return <SectionSkeleton title={t("home.attention.title")} />;
  if (datasets.status === "error") {
    return (
      <Section title={t("home.attention.title")}>
        <Note>{t("home.attention.error")}</Note>
      </Section>
    );
  }
  const flagged = datasets.data.filter((dataset) => attentionAxes(dataset.status_axes).length > 0);
  if (flagged.length === 0) return null;
  return (
    <Section
      title={t("home.attention.title")}
      action={
        <Link className="text-xs text-accent-subtle-foreground underline-offset-2 hover:underline" to="/tables?attention=1">
          {t("home.attention.viewAll", { count: flagged.length })}
        </Link>
      }
    >
      <ul>
        {flagged.slice(0, ATTENTION_LIMIT).map((dataset) => (
          <li className="border-b border-border last:border-0" key={dataset.dataset_id}>
            <Link
              className="flex flex-col gap-1 px-4 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between"
              to={`/tables/${encodeURIComponent(dataset.dataset_id)}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{dataset.title}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{dataset.dataset_id}</span>
              </span>
              <span className="flex flex-wrap gap-1">
                {attentionAxes(dataset.status_axes).map((axis) => (
                  <AxisValue axes={dataset.status_axes} axis={axis} key={axis} />
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RecentSnapshots({ state }: { state: Loadable<RecentSnapshot[]> }) {
  const { t } = useTranslation();
  if (state.status === "loading") return <SectionSkeleton title={t("home.snapshots.title")} />;
  return (
    <Section title={t("home.snapshots.title")}>
      {state.status === "error" ? (
        <Note>{t("home.snapshots.error")}</Note>
      ) : state.data.length === 0 ? (
        <Note>{t("home.snapshots.empty")}</Note>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px] leading-[18px]">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium" scope="col">{t("home.snapshots.table")}</th>
                <th className="px-4 py-2 font-medium" scope="col">{t("home.snapshots.snapshot")}</th>
                <th className="px-4 py-2 text-right font-medium" scope="col">{t("home.snapshots.rows")}</th>
                <th className="px-4 py-2 font-medium" scope="col">{t("home.snapshots.committed")}</th>
                <th className="px-4 py-2 font-medium" scope="col">{t("home.snapshots.run")}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map(({ logicalName, snapshot }) => {
                const name = splitTableName(logicalName);
                const href = name
                  ? `/tables/${encodeURIComponent(name.datasetId)}?${new URLSearchParams({ source: name.sourceKey })}`
                  : "/tables";
                return (
                  <tr className="border-b border-border last:border-0" key={`${logicalName}@${snapshot.snapshot_id}`}>
                    <td className="px-4 py-2">
                      <Link className="font-mono text-accent-subtle-foreground underline-offset-2 hover:underline" to={href}>
                        {logicalName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono">{snapshot.snapshot_id}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {snapshot.row_count === null ? <MissingStatus /> : snapshot.row_count.toLocaleString("ko-KR")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {snapshot.committed_at ? formatDateTime(snapshot.committed_at) : <MissingStatus />}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{snapshot.run_id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** Without a warehouse: the recent runs, as before. */
function RecentRuns({ state }: { state: Loadable<BuildListItem[]> }) {
  const { t } = useTranslation();
  if (state.status === "loading") return <SectionSkeleton title={t("home.recent.title")} />;
  const runs =
    state.status === "loaded"
      ? [...state.data].sort((a, b) => (Date.parse(b.startedAt ?? "") || 0) - (Date.parse(a.startedAt ?? "") || 0)).slice(0, RECENT_LIMIT)
      : [];
  return (
    <Section title={t("home.recent.title")}>
      {state.status === "error" ? (
        <Note>{t("home.recent.errorTitle")}</Note>
      ) : runs.length === 0 ? (
        <Note>{t("home.recent.emptyTitle")}</Note>
      ) : (
        <ul>
          {runs.map((run) => (
            <li className="border-b border-border last:border-0" key={run.id}>
              <Link
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                to={`/refresh-jobs/${encodeURIComponent(run.id)}`}
              >
                <span className="min-w-0 truncate font-medium">{run.title ?? run.id}</span>
                <span className="flex gap-3 text-xs text-muted-foreground">
                  <span>{run.status}</span>
                  <span>{run.startedAt ? formatDateTime(run.startedAt) : "—"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RecentAnalyses({ state }: { state: Loadable<{ analyses: SavedAnalysis[] }> }) {
  const { t } = useTranslation();
  if (state.status === "loading") return <SectionSkeleton title={t("home.analyses.title")} />;
  return (
    <Section
      title={t("home.analyses.title")}
      action={
        <Link className="text-xs text-accent-subtle-foreground underline-offset-2 hover:underline" to="/analyses">
          {t("home.analyses.viewAll")}
        </Link>
      }
    >
      {state.status === "error" ? (
        <Note>{t("home.analyses.error")}</Note>
      ) : state.data.analyses.length === 0 ? (
        <Note>{t("home.analyses.empty")}</Note>
      ) : (
        <ul>
          {state.data.analyses.slice(0, RECENT_LIMIT).map((analysis) => (
            <li className="border-b border-border last:border-0" key={analysis.analysis_id}>
              <Link
                className="block px-4 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                to={`/sql?${new URLSearchParams({ analysis: analysis.analysis_id })}`}
              >
                <span className="block truncate text-sm font-medium">{analysis.name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {analysis.bindings.map((binding) => `${binding.table}@${binding.snapshot_id}`).join(", ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Providers whose tables report an Access problem; left out when there are none. */
function ConnectionAttention({ datasets }: { datasets: Loadable<DatasetSummary[]> }) {
  const { t } = useTranslation();
  if (datasets.status !== "loaded") return null;
  const problems = connectionProblems(datasets.data);
  if (problems.length === 0) return null;
  return (
    <Section title={t("home.connections.title")}>
      <ul>
        {problems.map((problem) => (
          <li className="border-b border-border last:border-0" key={`${problem.provider}:${problem.access}`}>
            <Link
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              to="/connections"
            >
              <span className="min-w-0">
                <span className="block font-mono text-sm">{problem.provider}</span>
                <span className="block text-xs text-muted-foreground">{t("home.connections.tables", { count: problem.datasetIds.length })}</span>
              </span>
              <AxisValue axes={{ access: problem.access }} axis="access" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
