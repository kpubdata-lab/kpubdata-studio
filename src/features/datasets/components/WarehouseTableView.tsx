/**
 * Table Detail on a warehouse: the table opens on its current committed snapshot (#526).
 *
 * Nothing has to be picked first. Overview, Schema, Preview and Quality all read the
 * snapshot on screen — the current one, or a past one chosen in the Snapshots tab
 * (`?snapshot=`), which is the only place a past snapshot or run is chosen. The run that
 * produced a snapshot is shown as provenance, its id in monospace, never hidden.
 *
 * A dataset with several sources has one warehouse table per source; `?source=` names
 * the one on screen and the first is shown by default.
 *
 * Every value is a contract field: the dataset (`GET /datasets/{id}`), the table and its
 * snapshots (`GET /warehouse/tables/{name}`), the snapshot's columns (`POST
 * /warehouse/rows`), and the producing run's quality (`GET /builds/{run}/quality`). What
 * Builder did not send is `—`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { TableRowsPanel } from "@/features/data-table/TableRowsPanel";
import { getBuildQuality, getDataset, listDatasetRuns } from "@/features/datasets/api";
import { formatDateTime } from "@/features/datasets/model";
import { sourceKeyOf } from "@/features/datasets/warehouseTables";
import { qualityResultsForSource, summarizeQuality } from "@/features/quality/model";
import { coverageCounts, coverageOf } from "@/features/sql/snapshotCoverage";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";
import {
  type BuildQualityResponse,
  type DatasetDetailResponse,
  type DatasetRunSummary,
  type WarehouseRowsResponse,
  type WarehouseSnapshot,
  type WarehouseTable,
} from "@/shared/lib/builderApi";
import { warehouseApi } from "@/features/sql/warehouseApi";
import type { WarehouseTableDetailResponse } from "@/shared/lib/builderApi.schema";
import { Button, Card, EmptyState, ErrorState, LinkButton, PageHeader, Skeleton } from "@/shared/ui";
import { ActionableStatus, MissingStatus, NormalStatus, UnknownStatus } from "@/shared/ui/StatusState";

import { BuildsTab, QualityTab, type AsyncState } from "./RunPanels";
import { AxisValue, StatusAxes, actionableAxes } from "./StatusAxes";

const TABS = ["overview", "schema", "preview", "quality", "snapshots"] as const;
type Tab = (typeof TABS)[number];

/** Tabs a saved link may still carry from the run view. */
const LEGACY_TAB: Record<string, Tab> = { builds: "snapshots" };

function errorText(cause: unknown, fallbackKey: string): string {
  return cause instanceof Error ? cause.message : i18n.t(fallbackKey);
}

/**
 * Load `load()` for `key` while `enabled`. A result is only ever shown for the key it
 * was loaded for, so a switch of source or snapshot never shows the previous one's data.
 */
function useAsync<T>(key: string, enabled: boolean, load: (signal: AbortSignal) => Promise<T>, errorKey: string): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T> & { key?: string }>({ status: "idle" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (live) setState({ status: "loaded", data, key });
      })
      .catch((cause: unknown) => {
        if (live) setState({ status: "error", error: errorText(cause, errorKey), key });
      });
    return () => {
      live = false;
      controller.abort();
    };
    // `load` closes over the inputs `key` names.
  }, [key, enabled]);
  return state.key === key ? state : { status: enabled ? "loading" : "idle" };
}

export function WarehouseTableView({ datasetId, tables }: { datasetId: string; tables: WarehouseTable[] }) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);

  const sources = tables.map((table) => ({ table, sourceKey: sourceKeyOf(table, datasetId) ?? table.logical_name }));
  const requestedSource = searchParams.get("source");
  const selected = sources.find((entry) => entry.sourceKey === requestedSource) ?? sources.find((entry) => entry.table.current_snapshot_id !== null) ?? sources[0];
  const logicalName = selected.table.logical_name;

  const tabParam = searchParams.get("tab") ?? "";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : (LEGACY_TAB[tabParam] ?? "overview");

  const dataset = useAsync<DatasetDetailResponse>(datasetId, true, (signal) => getDataset(datasetId, signal), "datasetDetail.loadError");
  const detail = useAsync<WarehouseTableDetailResponse>(
    logicalName,
    true,
    (signal) => warehouseApi().getWarehouseTable(logicalName, signal),
    "tableDetail.errors.table",
  );

  const snapshots = detail.data?.snapshots ?? [];
  const currentId = detail.data?.current_snapshot_id ?? null;
  const requestedSnapshot = searchParams.get("snapshot");
  const viewedId = requestedSnapshot ?? currentId;
  const viewed = snapshots.find((snapshot) => snapshot.snapshot_id === viewedId);
  const isCurrent = viewed !== undefined && viewed.snapshot_id === currentId;
  const snapshotMissing = detail.status === "loaded" && requestedSnapshot !== null && viewed === undefined;
  const runId = viewed?.run_id ?? "";

  const quality = useAsync<BuildQualityResponse>(runId, tab === "quality" && Boolean(runId), (signal) => getBuildQuality(runId, signal), "datasetDetail.qualityErrorMsg");
  const runs = useAsync<{ runs: DatasetRunSummary[] }>(datasetId, tab === "snapshots", (signal) => listDatasetRuns(datasetId, 20, signal), "tableDetail.errors.runs");

  function update(updates: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace });
  }

  // Ask KPubData reads its context from the route (`?run=&source=`, assistant/context.ts).
  // The run is the one behind the snapshot on screen; no stage is written, because a
  // snapshot is not a stage and the context must not guess one.
  function askAboutThis() {
    update({ run: runId || null, source: selected.sourceKey, stage: null });
    openAssistantDrawer();
  }

  // A saved link to the removed AI tab still opens Ask KPubData, once the run is known.
  useEffect(() => {
    if (tabParam !== "ai" || detail.status !== "loaded") return;
    update({ tab: null, run: runId || null, source: selected.sourceKey, stage: null }, true);
    openAssistantDrawer();
  }, [tabParam, detail.status, runId]);

  if (dataset.status === "error") {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader title={datasetId} />
        <ErrorState title={t("datasetDetail.loadErrorTitle")} message={dataset.error} />
      </main>
    );
  }
  if (!dataset.data) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader title={datasetId} description={t("datasetDetail.loadingDesc")} />
        <Card>
          <Skeleton className="h-40 w-full" />
        </Card>
      </main>
    );
  }

  const info = dataset.data;
  const providers = [...new Set(info.sources.map((source) => source.provider))].join(", ");
  const attention = actionableAxes(info.status_axes);
  const queryHref = `/sql?${new URLSearchParams({ table: logicalName, ...(viewed && !isCurrent ? { snapshot: viewed.snapshot_id } : {}) })}`;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader
        title={info.title}
        meta={
          <>
            <span className="font-mono">{logicalName}</span>
            {providers ? <span> · {providers}</span> : null}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="secondary" aria-haspopup="dialog" onClick={askAboutThis}>
              {t("datasetDetail.askAboutThis")}
            </Button>
            {runId ? (
              <LinkButton size="sm" variant="secondary" to={`/refresh-jobs/${encodeURIComponent(runId)}/edit`}>
                {t("tableActions.refresh")}
              </LinkButton>
            ) : null}
            <LinkButton size="sm" to={queryHref}>
              {t("tableActions.query")}
            </LinkButton>
          </>
        }
      />
      {attention.length > 0 ? (
        <ul aria-label={t("tableDetail.attention")} className="flex flex-wrap gap-2">
          {attention.map((axis) => (
            <li key={axis}>
              <AxisValue axes={info.status_axes} axis={axis} />
            </li>
          ))}
        </ul>
      ) : null}

      {sources.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("tableDetail.sourceTables")}</span>
          {sources.map((entry) => (
            <button
              aria-pressed={entry === selected}
              className={`rounded-md border px-2 py-1 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${entry === selected ? "border-brand-primary bg-brand-subtle text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
              key={entry.table.logical_name}
              onClick={() => update({ source: entry.sourceKey, snapshot: null })}
              type="button"
            >
              {entry.sourceKey}
            </button>
          ))}
        </div>
      ) : null}

      {viewed && !isCurrent ? (
        <Card className="flex flex-wrap items-center justify-between gap-2 p-3" role="status">
          <span className="text-sm">
            {t("tableDetail.pastSnapshot")} <span className="font-mono">{viewed.snapshot_id}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => update({ snapshot: null })}>
            {t("tableDetail.backToCurrent")}
          </Button>
        </Card>
      ) : null}

      <div className="border-b border-border" role="tablist" aria-label={t("tableDetail.tabsLabel")}>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => update({ tab: id === "overview" ? null : id })}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab === id ? "border-brand-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`tableDetail.tabs.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <section className="min-w-0" role="tabpanel" aria-label={t(`tableDetail.tabs.${tab}`)}>
        {detail.status === "error" ? (
          <ErrorState title={t("tableDetail.errors.table")} message={detail.error} />
        ) : detail.status !== "loaded" ? (
          <Card>
            <Skeleton className="h-40 w-full" />
          </Card>
        ) : snapshotMissing ? (
          <Card variant="error" role="alert">
            <p className="font-semibold">{t("tableDetail.snapshotMissing", { snapshot: requestedSnapshot })}</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => update({ snapshot: null })}>
              {t("tableDetail.backToCurrent")}
            </Button>
          </Card>
        ) : tab === "snapshots" ? (
          <SnapshotsTab
            currentId={currentId}
            datasetId={datasetId}
            runs={runs}
            snapshots={snapshots}
            viewedId={viewed?.snapshot_id ?? null}
            onView={(snapshotId) => update({ snapshot: snapshotId === currentId ? null : snapshotId, tab: null })}
          />
        ) : !viewed ? (
          <Card>
            <EmptyState title={t("tableDetail.notCommitted")} description={t("tableDetail.notCommittedDesc")} />
          </Card>
        ) : tab === "overview" ? (
          <OverviewTab dataset={info} isCurrent={isCurrent} revision={isCurrent ? detail.data?.revision : undefined} snapshot={viewed} />
        ) : tab === "schema" ? (
          <SchemaTab snapshot={viewed.snapshot_id} table={logicalName} />
        ) : tab === "preview" ? (
          <TableRowsPanel autoStart key={`${logicalName}@${viewed.snapshot_id}`} snapshot={viewed.snapshot_id} table={logicalName} />
        ) : (
          <QualityTab
            datasetId={datasetId}
            drift={quality.data?.schema_drift[selected.sourceKey] ?? []}
            results={qualityResultsForSource(quality.data, selected.sourceKey)}
            runId={runId}
            source={selected.sourceKey}
            state={quality}
            status={summarizeQuality(quality.data, selected.sourceKey)}
          />
        )}
      </section>
    </main>
  );
}

function Definition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** The snapshot's fetch coverage: plain when complete, a badge when partial, `Unknown` otherwise. */
function CoverageValue({ snapshot }: { snapshot: WarehouseSnapshot }) {
  const { t } = useTranslation();
  const word = coverageOf(snapshot);
  if (word === "complete") return <NormalStatus>{t("tableDetail.coverage.complete")}</NormalStatus>;
  if (word === "partial") {
    return (
      <ActionableStatus axis={t("tableDetail.coverage.label")} tone="warning">
        {t("tableDetail.coverage.partial")}
      </ActionableStatus>
    );
  }
  return <UnknownStatus />;
}

function RowCount({ value }: { value: number | null }) {
  return value === null ? <MissingStatus /> : <span className="tabular-nums">{value.toLocaleString("ko-KR")}</span>;
}

function OverviewTab({ dataset, snapshot, isCurrent, revision }: { dataset: DatasetDetailResponse; snapshot: WarehouseSnapshot; isCurrent: boolean; revision?: number }) {
  const { t } = useTranslation();
  const counts = coverageCounts(snapshot);
  const reasons = snapshot.coverage?.reasons ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <h2 className="text-sm font-semibold">{t(isCurrent ? "tableDetail.currentSnapshot" : "tableDetail.snapshot")}</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Definition label={t("tableDetail.labels.snapshot")}>
            <span className="font-mono">{snapshot.snapshot_id}</span>
          </Definition>
          <Definition label={t("tableDetail.labels.committedAt")}>{snapshot.committed_at ? formatDateTime(snapshot.committed_at) : <MissingStatus />}</Definition>
          <Definition label={t("tableDetail.labels.rows")}>
            <RowCount value={snapshot.row_count} />
          </Definition>
          <Definition label={t("tableDetail.labels.revision")}>{revision === undefined ? <MissingStatus /> : <span className="font-mono">rev {revision}</span>}</Definition>
          <Definition label={t("tableDetail.coverage.label")}>
            <CoverageValue snapshot={snapshot} />
            {counts ? <span className="mt-0.5 block text-xs text-muted-foreground">{t("sql.coverage.counts", counts)}</span> : null}
            {reasons.length > 0 ? <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{reasons.join(", ")}</span> : null}
          </Definition>
          <Definition label={t("tableDetail.labels.run")}>
            <Link className="font-mono text-brand-text underline-offset-2 hover:underline" to={`/refresh-jobs/${encodeURIComponent(snapshot.run_id)}`}>
              {snapshot.run_id}
            </Link>
          </Definition>
        </dl>
      </Card>
      <Card>
        <h2 className="text-sm font-semibold">{t("tableDetail.status")}</h2>
        <StatusAxes axes={dataset.status_axes} className="mt-3 text-xs" />
        <h2 className="mt-4 text-sm font-semibold">{t("tableDetail.sources")}</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {dataset.sources.map((source) => (
            <li key={`${source.provider}.${source.dataset}`}>
              <span className="font-mono text-xs">{`${source.provider}.${source.dataset}`}</span>
              {source.alias ? <span className="text-muted-foreground"> · {source.alias}</span> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** The snapshot's columns, from one row page: names, types and Builder's hints. */
function SchemaTab({ table, snapshot }: { table: string; snapshot: string }) {
  const { t } = useTranslation();
  const page = useAsync<WarehouseRowsResponse>(
    `${table}@${snapshot}`,
    true,
    (signal) => warehouseApi().warehouseRows({ table, snapshot, page_size: 1, count: "none" }, signal),
    "tableDetail.errors.schema",
  );
  if (page.status === "error") return <ErrorState title={t("tableDetail.errors.schema")} message={page.error} />;
  if (!page.data) {
    return (
      <Card>
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }
  const meta = new Map(page.data.column_meta.map((column) => [column.name, column]));
  return (
    <Card className="overflow-hidden p-0">
      <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{t("tableDetail.schemaNote", { count: page.data.columns.length })}</p>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px] leading-[18px]">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.schema.column")}</th>
              <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.schema.type")}</th>
              <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.schema.label")}</th>
              <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.schema.unit")}</th>
            </tr>
          </thead>
          <tbody>
            {page.data.columns.map((name) => {
              const column = meta.get(name);
              return (
                <tr className="border-b border-border last:border-0" key={name}>
                  <td className="px-4 py-2 font-mono">{name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{column ? column.logical_type : <MissingStatus />}</td>
                  <td className="px-4 py-2">{column?.display?.label ?? <MissingStatus />}</td>
                  <td className="px-4 py-2">{column?.unit?.name ?? <MissingStatus />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SnapshotsTab({
  snapshots,
  currentId,
  viewedId,
  datasetId,
  runs,
  onView,
}: {
  snapshots: WarehouseSnapshot[];
  currentId: string | null;
  viewedId: string | null;
  datasetId: string;
  runs: AsyncState<{ runs: DatasetRunSummary[] }>;
  onView: (snapshotId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{t("tableDetail.snapshotsNote")}</p>
        {snapshots.length === 0 ? (
          <EmptyState title={t("tableDetail.notCommitted")} description={t("tableDetail.notCommittedDesc")} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px] leading-[18px]">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.labels.snapshot")}</th>
                  <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.labels.committedAt")}</th>
                  <th className="px-4 py-2 text-right font-medium" scope="col">{t("tableDetail.labels.rows")}</th>
                  <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.coverage.label")}</th>
                  <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.labels.run")}</th>
                  <th className="px-4 py-2 font-medium" scope="col"><span className="sr-only">{t("tableDetail.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => {
                  const committed = snapshot.state === "committed";
                  const run = encodeURIComponent(snapshot.run_id);
                  return (
                    <tr className={`border-b border-border align-top last:border-0 ${snapshot.snapshot_id === viewedId ? "bg-brand-subtle" : ""}`} key={snapshot.snapshot_id}>
                      <td className="px-4 py-2">
                        <span className="font-mono">{snapshot.snapshot_id}</span>
                        {snapshot.snapshot_id === currentId ? <span className="ml-2 text-xs text-muted-foreground">{t("tableDetail.current")}</span> : null}
                        {!committed ? (
                          <span className="ml-2">
                            <ActionableStatus tone="warning">{t("tableDetail.quarantined")}</ActionableStatus>
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{snapshot.committed_at ? formatDateTime(snapshot.committed_at) : <MissingStatus />}</td>
                      <td className="px-4 py-2 text-right">
                        <RowCount value={snapshot.row_count} />
                      </td>
                      <td className="px-4 py-2">
                        <CoverageValue snapshot={snapshot} />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{snapshot.run_id}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-start justify-end gap-2">
                          {committed && snapshot.snapshot_id !== viewedId ? (
                            <Button size="sm" variant="secondary" onClick={() => onView(snapshot.snapshot_id)}>
                              {t("tableDetail.view")}
                            </Button>
                          ) : null}
                          <details className="text-xs">
                            <summary aria-label={t("tableDetail.more", { snapshot: snapshot.snapshot_id })} className="cursor-pointer list-none rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              ⋯
                            </summary>
                            <ul className="mt-1 space-y-1 whitespace-nowrap">
                              <li>
                                <Link className="text-brand-text underline" to={`/refresh-jobs/${run}`}>{t("tableDetail.runDetail")}</Link>
                              </li>
                              <li>
                                <Link className="text-brand-text underline" to={`/refresh-jobs/${run}/edit`}>{t("tableDetail.editSpec")}</Link>
                              </li>
                              <li>
                                <Link className="text-brand-text underline" to={`/refresh-jobs/${run}/publish?dataset=${encodeURIComponent(datasetId)}`}>{t("datasetDetail.publishRun")}</Link>
                              </li>
                            </ul>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {runs.status === "error" ? (
        <Card variant="error" role="alert">{runs.error}</Card>
      ) : runs.data ? (
        <BuildsTab runs={runs.data.runs} selectedRunId={snapshots.find((snapshot) => snapshot.snapshot_id === viewedId)?.run_id ?? ""} />
      ) : (
        <Card>
          <Skeleton className="h-24 w-full" />
        </Card>
      )}
    </div>
  );
}
