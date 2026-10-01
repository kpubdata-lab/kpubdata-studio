/**
 * Table Detail (#526).
 *
 * On a Builder with a warehouse a table opens on its current committed snapshot, with no
 * run, source or stage to pick first: `WarehouseTableView`. Runs are provenance there —
 * the run behind each snapshot, in the Snapshots tab.
 *
 * A deployment without a warehouse, or a table with nothing committed yet, keeps the
 * run-based view below (run · source · stage pickers) and says why in one line.
 */
import { i18n } from "@/shared/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  getBuildQuality,
  getBuildStageDetail,
  getDataset,
  listBuildStages,
  listDatasetRuns,
} from "@/features/datasets/api";
import { BuildsTab, QualityTab, type AsyncState } from "@/features/datasets/components/RunPanels";
import { StageBadge } from "@/features/datasets/components/StageBadge";
import { StageSampleEmpty } from "@/features/datasets/components/StageSampleEmpty";
import { StatusAxes } from "@/features/datasets/components/StatusAxes";
import { WarehouseTableView } from "@/features/datasets/components/WarehouseTableView";
import { RunLicence } from "@/features/licence/LicenceSummary";
import { useRunLicence } from "@/features/licence/useRunLicence";
import { RUN_LOOKUP_API_VERSION, useRequestedRun } from "@/features/datasets/useRequestedRun";
import { RUN_HISTORY_LIMIT, useRunHistoryPaging } from "@/features/datasets/runHistory";
import { datasetTablesOf } from "@/features/datasets/warehouseTables";
import {
  DATASET_STAGES,
  formatDateTime,
  highestCompletedStage,
  type DatasetStage,
} from "@/features/datasets/model";
import { QualityBadge } from "@/features/quality/QualityBadge";
import { qualityResultsForSource, summarizeQuality } from "@/features/quality/model";
import { detectWarehouse } from "@/features/sql/warehouse";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { DataTable } from "@/features/data-table/DataTable";
import type {
  BuildQualityResponse,
  DatasetDetailResponse,
  DatasetRunSummary,
  RunStagesResponse,
  StageDetailResponse,
  WarehouseTable,
} from "@/shared/lib/builderApi";
import { Button, Card, EmptyState, ErrorState, LinkButton, PageHeader, Skeleton, StageLegend } from "@/shared/ui";

type DetailTab = "overview" | "schema" | "preview" | "quality" | "builds";

const TABS: { id: DetailTab; labelKey: string }[] = [
  { id: "overview", labelKey: "tableDetail.tabs.overview" },
  { id: "schema", labelKey: "tableDetail.tabs.schema" },
  { id: "preview", labelKey: "tableDetail.tabs.preview" },
  { id: "quality", labelKey: "tableDetail.tabs.quality" },
  { id: "builds", labelKey: "labels.runs" },
];

interface CoreState {
  status: "loading" | "loaded" | "error";
  dataset?: DatasetDetailResponse;
  runs?: DatasetRunSummary[];
  error?: string;
}

type ViewMode =
  | { status: "loading" }
  | { status: "snapshot"; tables: WarehouseTable[] }
  | { status: "run"; reason: "noWarehouse" | "noSnapshot" };

export function DatasetDetailPage() {
  const { t } = useTranslation();
  const { datasetId = "" } = useParams<{ datasetId: string }>();
  const [mode, setMode] = useState<ViewMode>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setMode({ status: "loading" });
    void detectWarehouse().then((warehouse) => {
      if (cancelled) return;
      if (warehouse.status !== "available") return setMode({ status: "run", reason: "noWarehouse" });
      const tables = datasetTablesOf(warehouse.tables, datasetId);
      // A table with no committed snapshot yet has nothing to open on; the run view still has its runs.
      if (!tables.some((table) => table.current_snapshot_id !== null)) return setMode({ status: "run", reason: "noSnapshot" });
      setMode({ status: "snapshot", tables });
    });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  if (mode.status === "loading") {
    return <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10"><PageHeader title={datasetId} description={t("datasetDetail.loadingDesc")} /><Card><Skeleton className="h-40 w-full" /></Card></main>;
  }
  if (mode.status === "snapshot") return <WarehouseTableView datasetId={datasetId} tables={mode.tables} />;
  return <RunDetailView note={t(`tableDetail.runView.${mode.reason}`)} />;
}

const selectClassName =
  "h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Definition({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm text-foreground">{children}</dd></div>;
}

/** General role of Bronze/Silver/Gold stages (not describing this dataset's actual history). */
/** Store keys only, not labels — putting sentences in module constants freezes language at import time (#350). */
const STAGE_EXPLAINER_KEY: Record<DatasetStage, string> = {
  bronze: "datasetDetail.stageBronze",
  silver: "datasetDetail.stageSilver",
  gold: "datasetDetail.stageGold",
};

/** The run-based view: pick a run, a source and a stage. */
function RunDetailView({ note }: { note: string }) {
  const { t } = useTranslation();
  const { datasetId = "" } = useParams<{ datasetId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);
  const [core, setCore] = useState<CoreState>({ status: "loading" });
  const [stagesState, setStagesState] = useState<AsyncState<RunStagesResponse>>({ status: "idle" });
  const [qualityState, setQualityState] = useState<AsyncState<BuildQualityResponse>>({ status: "idle" });
  const [stageDetailState, setStageDetailState] = useState<AsyncState<StageDetailResponse>>({ status: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    setCore({ status: "loading" });
    Promise.all([getDataset(datasetId, controller.signal), listDatasetRuns(datasetId, RUN_HISTORY_LIMIT, controller.signal)])
      .then(([dataset, runs]) => setCore({ status: "loaded", dataset, runs: runs.runs }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setCore({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("datasetDetail.loadError") });
      });
    return () => controller.abort();
  }, [datasetId]);

  // "Show more" replaces the first page with a larger one (#653); everything below reads it.
  const history = useRunHistoryPaging(datasetId, core.runs);
  const runs = history.runs;
  const requestedRun = searchParams.get("run");
  const selectedRunId = requestedRun || core.dataset?.latest_run_id || "";
  // Not being in the newest page does not make a run invalid (#418): Builder is asked
  // directly, and says whether it is this dataset's and the caller's.
  const requested = useRequestedRun(datasetId, requestedRun, runs);
  const invalidRun = requested.status === "not_found" || requested.status === "forbidden" || requested.status === "error" || requested.status === "unsupported";
  const runPending = requested.status === "loading";
  const runOptions =
    requested.status === "available" && !requested.inPage && runs ? [...runs, requested.run] : runs;

  useEffect(() => {
    if (!selectedRunId || invalidRun || runPending) {
      setStagesState({ status: "idle" });
      setQualityState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setStagesState({ status: "loading" });
    setQualityState({ status: "loading" });
    listBuildStages(selectedRunId, controller.signal)
      .then((data) => setStagesState({ status: "loaded", data }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setStagesState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("datasetDetail.stagesErrorMsg") });
      });
    getBuildQuality(selectedRunId, controller.signal)
      .then((data) => setQualityState({ status: "loaded", data }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setQualityState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("datasetDetail.qualityErrorMsg") });
      });
    return () => controller.abort();
  }, [selectedRunId, invalidRun, runPending]);

  const requestedSource = searchParams.get("source");
  const sourceEntries = stagesState.data?.sources ?? [];
  const invalidSource = Boolean(requestedSource && stagesState.status === "loaded" && !sourceEntries.some((source) => source.source_key === requestedSource));
  const selectedSource = requestedSource || sourceEntries[0]?.source_key || "";
  const sourceStageEntry = sourceEntries.find((source) => source.source_key === selectedSource);
  const requestedStage = searchParams.get("stage");
  const validRequestedStage = DATASET_STAGES.includes(requestedStage as DatasetStage) ? requestedStage as DatasetStage : undefined;
  const selectedStage = validRequestedStage ?? (sourceStageEntry ? highestCompletedStage(sourceStageEntry) : "bronze");

  // Remove invalid stage parameters from URL to align UI fallback state with URL.
  useEffect(() => {
    if (requestedStage && !validRequestedStage) {
      const next = new URLSearchParams(searchParams);
      next.delete("stage");
      setSearchParams(next);
    }
  }, [requestedStage, validRequestedStage, searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedRunId || !selectedSource || invalidRun || runPending || invalidSource) {
      setStageDetailState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setStageDetailState({ status: "loading" });
    getBuildStageDetail(selectedRunId, selectedStage, selectedSource, 20, controller.signal)
      .then((data) => setStageDetailState({ status: "loaded", data }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setStageDetailState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("datasetDetail.stageDetailErrorMsg") });
      });
    return () => controller.abort();
  }, [selectedRunId, selectedSource, selectedStage, invalidRun, runPending, invalidSource]);

  function updateContext(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next);
  }

  // Ask KPubData reads its context only from the route's ?run=&source=&stage= (context.ts, no-guess
  // principle), so the selections this screen computed are written to the URL before the drawer opens.
  // Otherwise the drawer shows the run as "—" and Generated SQL/Result Preview come up empty (UI audit #5).
  // Source is included so stage evidence is not fail-closed in multi-source runs (#319 follow-up).
  // The header action and the Passport entry share this so the rule exists once. There is no AI tab:
  // Ask KPubData is a feature opened from here, not a place inside the page (#421).
  function askAboutThis() {
    updateContext({ run: selectedRunId, source: selectedSource || null, stage: selectedStage });
    openAssistantDrawer();
  }

  function goToTab(tab: DetailTab) {
    updateContext({ tab: tab === "overview" ? null : tab });
  }

  const tabParam = searchParams.get("tab");
  const selectedTab = TABS.find((tab) => tab.id === tabParam)?.id ?? "overview";
  const selectedRun = runOptions?.find((run) => run.run_id === selectedRunId);
  const validation = summarizeQuality(qualityState.data, selectedSource);
  const selectedQualityResults = qualityResultsForSource(qualityState.data, selectedSource);
  const selectedDrift = qualityState.data?.schema_drift[selectedSource] ?? [];

  // A saved link to the removed AI tab (`?tab=ai`) still leads to Ask KPubData: once the selections are
  // known it drops the tab, back-fills the same run/source/stage the header action would, and opens the
  // drawer. It waits for the stages so source/stage are filled from the same place as the click path,
  // and uses replace so the old link does not stay in history. An explicit valid value is never
  // overwritten; invalid state is left for the error cards above.
  useEffect(() => {
    if (tabParam !== "ai" || core.status !== "loaded" || invalidRun || runPending || invalidSource) return;
    if (stagesState.status === "idle" || stagesState.status === "loading") return;
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    if (selectedRunId && !requestedRun) next.set("run", selectedRunId);
    if (stagesState.status === "loaded" && selectedSource) {
      if (!requestedSource) next.set("source", selectedSource);
      if (!requestedStage) next.set("stage", selectedStage);
    }
    setSearchParams(next, { replace: true });
    openAssistantDrawer();
  }, [
    tabParam,
    core.status,
    invalidRun,
    runPending,
    invalidSource,
    stagesState.status,
    selectedRunId,
    requestedRun,
    selectedSource,
    requestedSource,
    requestedStage,
    selectedStage,
    searchParams,
    setSearchParams,
    openAssistantDrawer,
  ]);

  // Overall run state ("ok"/"failed"/"cancelled") and selected source·stage state ("completed"/"failed"/
  // "not_run"/"unavailable") use different vocabularies and are separate scopes — when a run has multiple
  // sources, the selected source's stage can be completed/PASS while the overall run is failed due to different
  // source's failure. This isn't contradiction; it reflects that two canonical sources differ. Rather than hiding
  // or forcing values to match, explain why states can diverge using actual data (different source's stage failure).
  const otherFailingSources = useMemo(
    () =>
      sourceEntries
        .filter((source) => source.source_key !== selectedSource)
        .filter((source) => DATASET_STAGES.some((stage) => source[stage].status === "failed"))
        .map((source) => source.source_key),
    [sourceEntries, selectedSource],
  );
  const runStatus = selectedRun?.status ?? core.dataset?.status;
  const runFailedButSelectedStageOk =
    runStatus === "failed" &&
    sourceStageEntry?.[selectedStage].status === "completed" &&
    otherFailingSources.length > 0;

  const summaryRowCount = useMemo(() => {
    const detail = stageDetailState.data;
    if (detail?.stage === "bronze") return detail.record_count;
    if (detail?.stage === "silver" || detail?.stage === "gold") return detail.row_count;
    return null;
  }, [stageDetailState.data]);

  if (core.status === "loading") {
    return <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10"><PageHeader title={datasetId} description={t("datasetDetail.loadingDesc")} /><Card><Skeleton className="h-40 w-full" /></Card></main>;
  }

  if (core.status === "error" || !core.dataset || !core.runs) {
    return <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10"><PageHeader title={datasetId || t("datasetDetail.fallbackTitle")} /><ErrorState title={t("datasetDetail.loadErrorTitle")} message={core.error} /></main>;
  }

  if (invalidRun) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader title={core.dataset.title} meta={<span className="font-mono">{core.dataset.dataset_id}</span>} />
        <Card variant="error" role="alert"><p className="font-semibold">{t(requested.status === "forbidden" ? "datasetDetail.forbiddenRunTitle" : requested.status === "error" ? "datasetDetail.runCheckFailedTitle" : requested.status === "unsupported" ? "datasetDetail.runLookupUnsupportedTitle" : "datasetDetail.invalidRunTitle")}</p><p className="mt-2 text-sm">{t(requested.status === "forbidden" ? "datasetDetail.forbiddenRunBody" : requested.status === "error" ? "datasetDetail.runCheckFailedBody" : requested.status === "unsupported" ? "datasetDetail.runLookupUnsupportedBody" : "datasetDetail.invalidRunBody", { run: requestedRun, version: RUN_LOOKUP_API_VERSION })}</p><Button className="mt-4" variant="secondary" onClick={() => updateContext({ run: null, source: null, stage: null })}>{t("datasetDetail.viewLatest")}</Button></Card>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader
        title={core.dataset.title}
        meta={<><span className="block font-mono">{core.dataset.dataset_id}</span><span className="block">{core.dataset.sources.map((source) => source.provider).join(", ")} · {selectedSource || t("datasetDetail.sourceLoading")} · {t("labels.run")} {selectedRunId}{selectedRunId === core.dataset.latest_run_id ? ` ${t("labels.latest")}` : ""}</span></>}
        actions={<><span title={t("datasetDetail.stageStatusTitle", { source: selectedSource || "—", stage: selectedStage })} className="inline-flex items-center gap-2 rounded-full bg-brand-subtle px-3 py-1 text-xs font-semibold capitalize text-brand-text"><span>{selectedStage}</span><span className="font-normal"><StageBadge status={sourceStageEntry?.[selectedStage].status} /></span></span><QualityBadge status={validation} /><Button size="sm" variant="secondary" aria-haspopup="dialog" onClick={askAboutThis}>{t("datasetDetail.askAboutThis")}</Button><LinkButton size="sm" variant="secondary" to={`/refresh-jobs/${encodeURIComponent(selectedRunId)}/edit`}>{t("tableActions.refresh")}</LinkButton><LinkButton size="sm" to={`/sql?${new URLSearchParams({ table: core.dataset.dataset_id, run: selectedRunId, stage: selectedStage === "bronze" ? "silver" : selectedStage, ...(selectedSource ? { source: selectedSource } : {}) })}`}>{t("tableActions.query")}</LinkButton><LinkButton size="sm" to={`/refresh-jobs/${encodeURIComponent(selectedRunId)}/publish?dataset=${encodeURIComponent(core.dataset.dataset_id)}`}>{t("datasetDetail.publishRun")}</LinkButton></>}
      />
      <p className="text-xs text-muted-foreground">{note}</p>
      <StatusAxes axes={core.dataset.status_axes} />

      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-52 flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("labels.run")}<select aria-label={t("datasetDetail.runSelect")} className={`mt-1 w-full ${selectClassName}`} value={selectedRunId} onChange={(event) => updateContext({ run: event.target.value === core.dataset?.latest_run_id ? null : event.target.value, source: null, stage: null })}>{(runOptions ?? []).map((run) => <option key={run.run_id} value={run.run_id}>{run.run_id}{run.run_id === core.dataset?.latest_run_id ? ` ${t("labels.latest")}` : ""}</option>)}</select></label>
        <label className="min-w-52 flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("labels.source")}<select aria-label={t("datasetDetail.sourceSelect")} className={`mt-1 w-full ${selectClassName}`} value={selectedSource} disabled={stagesState.status !== "loaded"} onChange={(event) => updateContext({ source: event.target.value, stage: null })}>{invalidSource && requestedSource ? <option value={requestedSource}>{t("datasetDetail.missingSource", { source: requestedSource })}</option> : null}{sourceEntries.map((source) => <option key={source.source_key} value={source.source_key}>{source.source_key}</option>)}</select></label>
        <label className="min-w-44 flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("labels.stage")}<select aria-label={t("datasetDetail.stageSelect")} className={`mt-1 w-full ${selectClassName}`} value={selectedStage} disabled={!sourceStageEntry} onChange={(event) => updateContext({ stage: event.target.value })}>{DATASET_STAGES.map((stageName) => <option key={stageName} value={stageName}>{stageName} · {sourceStageEntry?.[stageName].status ?? "—"}</option>)}</select></label>
        <div title={t("datasetDetail.runStatusTitle")} className="flex min-h-9 items-center gap-2 px-2 text-xs text-muted-foreground"><span>{t("datasetDetail.runStatusLabel")}</span><strong className="text-foreground">{runStatus}</strong></div>
      </Card>
      <StageLegend />

      {stagesState.status === "error" ? <Card variant="error" role="alert">{stagesState.error}</Card> : invalidSource ? <Card variant="error" role="alert">{t("datasetDetail.invalidSource", { source: requestedSource })}</Card> : null}
      {runFailedButSelectedStageOk ? (
        <Card variant="error" role="alert">
          <p className="font-semibold">{t("datasetDetail.runFailedTitle", { stage: selectedStage })}</p>
          <p className="mt-1 text-sm">
            {t("datasetDetail.runFailedBody", { sources: otherFailingSources.join(", ") })}
          </p>
        </Card>
      ) : null}

      <div className="border-b border-border" role="tablist" aria-label={t("tableDetail.tabsLabel")}>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selectedTab === tab.id}
              onClick={() => goToTab(tab.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${selectedTab === tab.id ? "border-brand-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <section role="tabpanel" aria-label={t(TABS.find((tab) => tab.id === selectedTab)?.labelKey ?? "tableDetail.tabs.overview")}>
        {selectedTab === "overview" ? <OverviewTab dataset={core.dataset} selectedRun={selectedRun} runStatus={runStatus} selectedSource={selectedSource} selectedStage={selectedStage} sourceStages={sourceStageEntry} stageDetail={stageDetailState.data} stageError={stageDetailState.error} rowCount={summaryRowCount} validation={validation} onSelectStage={(stageName) => updateContext({ stage: stageName })} onSelectTab={goToTab} onAsk={askAboutThis} /> : null}
        {selectedTab === "schema" ? <SchemaTab state={stageDetailState} drift={selectedDrift} /> : null}
        {selectedTab === "preview" ? <PreviewTab state={stageDetailState} qualityState={qualityState} qualityStatus={validation} qualityResults={selectedQualityResults} onOpenQuality={() => updateContext({ tab: "quality" })} /> : null}
        {selectedTab === "quality" ? <QualityTab state={qualityState} status={validation} results={selectedQualityResults} drift={selectedDrift} datasetId={datasetId} runId={selectedRunId} source={selectedSource} stage={selectedStage} /> : null}
        {selectedTab === "builds" ? <BuildsTab runs={runs ?? core.runs} selectedRunId={selectedRunId} paging={history} /> : null}
      </section>
    </main>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return <Card className="p-5"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><div className="mt-2 text-2xl font-bold tracking-tight">{value}</div><div className="mt-1 text-xs text-muted-foreground">{sub}</div></Card>;
}

function OverviewTab({ dataset, selectedRun, runStatus, selectedSource, selectedStage, sourceStages, stageDetail, stageError, rowCount, validation, onSelectStage, onSelectTab, onAsk }: { dataset: DatasetDetailResponse; selectedRun?: DatasetRunSummary; runStatus?: string; selectedSource: string; selectedStage: DatasetStage; sourceStages?: RunStagesResponse["sources"][number]; stageDetail?: StageDetailResponse; stageError?: string; rowCount: number | null; validation: ReturnType<typeof summarizeQuality>; onSelectStage: (stage: DatasetStage) => void; onSelectTab: (tab: DetailTab) => void; onAsk: () => void }) {
  const { t } = useTranslation();
  const columnCount = stageDetail?.stage === "silver" ? stageDetail.schema.length : stageDetail?.stage === "gold" ? stageDetail.columns.length : null;
  const artifactSummary = stageDetail?.stage === "gold" ? stageDetail.exports.map((item) => item.kind).join(", ") || t("datasetDetail.unpublished") : t("datasetDetail.notGoldStage");
  return <div className="space-y-4">
    <DataPassport dataset={dataset} selectedRun={selectedRun} runStatus={runStatus} selectedSource={selectedSource} selectedStage={selectedStage} sourceStages={sourceStages} columnCount={columnCount} artifactSummary={artifactSummary} validation={validation} onAsk={onAsk} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label={t("datasetDetail.labels.rows")} value={rowCount === null ? "—" : rowCount.toLocaleString("ko-KR")} sub={selectedStage} /><MetricCard label={t("datasetDetail.labels.columns")} value={columnCount ?? "—"} sub={t("datasetDetail.labels.stageResponse")} /><MetricCard label={t("labels.validation")} value={<QualityBadge status={validation} />} sub={selectedSource || t("datasetDetail.noSource")} /><MetricCard label={t("labels.updated")} value={<span className="text-lg">{formatDateTime(selectedRun?.finished_at ?? selectedRun?.started_at ?? dataset.updated_at)}</span>} sub={t("datasetDetail.runValue", { id: selectedRun?.run_id ?? dataset.latest_run_id })} /></div>
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]"><Card><h3 className="text-sm font-semibold">{t("datasetDetail.labels.lineage")}</h3>{sourceStages ? <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"><div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-center text-sm font-semibold">{t("labels.source")}<span className="mt-1 block text-xs font-normal text-muted-foreground">{selectedSource}</span></div>{DATASET_STAGES.map((stageName) => <div key={stageName} className="contents"><span aria-hidden="true" className="text-center text-muted-foreground">→</span><button type="button" aria-label={`${stageName} ${sourceStages[stageName].status}`} aria-pressed={selectedStage === stageName} onClick={() => onSelectStage(stageName)} className={`rounded-lg border px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedStage === stageName ? "border-brand-primary bg-brand-subtle" : "border-border bg-card hover:bg-muted"}`}><span className="block text-sm font-semibold capitalize">{stageName}</span><span className="mt-1 block"><StageBadge status={sourceStages[stageName].status} /></span><span className="mt-1 block text-[11px] font-normal text-muted-foreground">{t(STAGE_EXPLAINER_KEY[stageName])}</span></button></div>)}</div> : <Skeleton className="mt-4 h-24 w-full" />}</Card><Card><h3 className="text-sm font-semibold">{t("datasetDetail.labels.stageDetail")} · <span className="capitalize">{selectedStage}</span></h3>{stageError ? <p className="mt-3 text-sm text-status-failure">{stageError}</p> : !stageDetail ? <Skeleton className="mt-4 h-24 w-full" /> : <><dl className="mt-4 space-y-3"><Definition label={t("labels.status")}><StageBadge status={stageDetail.status} /></Definition><Definition label={t("datasetDetail.labels.available")}>{stageDetail.available ? t("labels.yes") : t("labels.no")}</Definition><Definition label={t("datasetDetail.labels.providerSource")}>{dataset.sources.map((source) => `${source.provider}.${source.dataset}`).join(", ")} · {selectedSource}</Definition><Definition label={t("labels.output")}>{stageDetail.stage === "gold" ? (stageDetail.exports.map((item) => item.kind).join(", ") || t("datasetDetail.outputNone")) : t("datasetDetail.outputNotProvided")}</Definition></dl><div className="mt-4 flex gap-2"><Button variant="secondary" size="sm" onClick={() => onSelectTab("preview")}>{t("tableDetail.tabs.preview")}</Button><Button variant="secondary" size="sm" onClick={() => onSelectTab("quality")}>{t("datasetDetail.viewQuality")}</Button></div></>}</Card></div>
  </div>;
}

/**
 * Data Passport — "what is this dataset, where did it come from, and can it be trusted?"
 * at a glance with trust summary (#Phase2 UI polish). Doesn't require new backend data —
 * reuse only values already fetched on this page. Don't fabricate missing fields; clearly
 * mark as "verification unavailable" / "not provided" or omit. The terms of use are the
 * selected run's BuildSpec declaration (`GET /builds/{run_id}/spec`, builder#764): a field
 * it does not declare is shown as unknown, never filled in.
 *
 * "Run state (overall)" and "selected Source·Stage state" use different vocabularies (run-level
 * aggregate vs source/stage unit) so values can diverge (see :174-178 runFailedButSelectedStageOk
 * reference) — keep fields separate with distinct labels rather than merging to preserve scope difference.
 */
function DataPassport({ dataset, selectedRun, runStatus, selectedSource, selectedStage, sourceStages, columnCount, artifactSummary, validation, onAsk }: { dataset: DatasetDetailResponse; selectedRun?: DatasetRunSummary; runStatus?: string; selectedSource: string; selectedStage: DatasetStage; sourceStages?: RunStagesResponse["sources"][number]; columnCount: number | null; artifactSummary: string; validation: ReturnType<typeof summarizeQuality>; onAsk: () => void }) {
  const { t } = useTranslation();
  const runId = selectedRun?.run_id ?? "";
  const licence = useRunLicence(runId);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("datasetDetail.passportTitle")}</h3>
        <button type="button" aria-haspopup="dialog" className="text-xs font-medium text-brand-text underline" onClick={onAsk}>
          {t("datasetDetail.assistantHint")}
        </button>
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Definition label={t("datasetDetail.labels.providerSource")}>{dataset.sources.map((source) => `${source.provider}.${source.dataset}`).join(", ") || t("datasetDetail.unavailable")}</Definition>
        <Definition label={t("labels.table")}>{dataset.title}<span className="block font-mono text-xs text-muted-foreground">{dataset.dataset_id}</span></Definition>
        <Definition label={t("datasetDetail.runStatusAll")}>{runStatus ?? t("datasetDetail.unavailable")}</Definition>
        <Definition label={t("datasetDetail.selectedStageStatus")}><StageBadge status={sourceStages?.[selectedStage].status} /></Definition>
        <Definition label={t("labels.quality")}><QualityBadge status={validation} /></Definition>
        <Definition label={t("labels.schema")}>{columnCount === null ? t("datasetDetail.schemaMissing") : t("datasetDetail.columnCount", { count: columnCount })}</Definition>
        <Definition label={t("datasetDetail.labels.specDigest")}>{selectedRun?.spec_digest ? <span className="break-all font-mono text-xs">{selectedRun.spec_digest}</span> : t("datasetDetail.unavailable")}</Definition>
        <Definition label={t("datasetDetail.labels.snapshotFiles")}>{artifactSummary}</Definition>
      </dl>
      <div className="mt-4 border-t border-border pt-4">
        <RunLicence headingLevel={4} runId={runId} state={licence} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {t("datasetDetail.tabsHint", { source: selectedSource || t("datasetDetail.noSource") })}
      </p>
    </Card>
  );
}

function SchemaTab({ state, drift }: { state: AsyncState<StageDetailResponse>; drift: BuildQualityResponse["schema_drift"][string] }) {
  const { t } = useTranslation();
  if (state.status === "loading" || state.status === "idle") return <Card><Skeleton className="h-40 w-full" /></Card>;
  if (state.status === "error" || !state.data) return <Card variant="error" role="alert">{state.error}</Card>;
  const detail = state.data;
  if (detail.stage === "silver" && detail.schema.length > 0) return <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><h3 className="text-sm font-semibold">{t("labels.schemaDrift")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("datasetDetail.schemaSilverNote")}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="px-5 py-3">{t("labels.column")}</th><th className="px-5 py-3">{t("labels.type")}</th><th className="px-5 py-3">{t("labels.missing")}</th><th className="px-5 py-3">{t("datasetDetail.changeCol")}</th></tr></thead><tbody>{detail.schema.map((column) => { const finding = drift.find((item) => item.column === column.name); const nullCount = detail.statistics?.null_counts[column.name]; const rowCount = detail.statistics?.row_count; return <tr key={column.name} className="border-b border-border last:border-0"><td className="px-5 py-3 font-medium">{column.name}</td><td className="px-5 py-3">{column.dtype}</td><td className="px-5 py-3">{nullCount !== undefined && rowCount ? `${((nullCount / rowCount) * 100).toFixed(1)}%` : "—"}</td><td className="px-5 py-3">{finding ? <span className="rounded-full bg-status-warning-subtle px-2 py-1 text-xs font-medium text-status-warning">{finding.kind}</span> : "—"}</td></tr>; })}</tbody></table></div></Card>;
  if (detail.stage === "gold" && detail.columns.length > 0) return <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><h3 className="text-sm font-semibold">{t("labels.schemaDrift")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("datasetDetail.schemaGoldNote")}</p></div><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="px-5 py-3">{t("labels.column")}</th><th className="px-5 py-3">{t("labels.type")}</th><th className="px-5 py-3">{t("labels.missing")}</th><th className="px-5 py-3">{t("datasetDetail.changeCol")}</th></tr></thead><tbody>{detail.columns.map((column) => <tr key={column} className="border-b border-border last:border-0"><td className="px-5 py-3 font-medium">{column}</td><td className="px-5 py-3">—</td><td className="px-5 py-3">—</td><td className="px-5 py-3">{drift.find((item) => item.column === column)?.kind ?? "—"}</td></tr>)}</tbody></table></Card>;
  return <Card><EmptyState title={t("datasetDetail.schemaNone")} description={t("datasetDetail.schemaNoneDesc", { stage: detail.stage })} /></Card>;
}

export function PreviewTab({ state, qualityState, qualityStatus, qualityResults, onOpenQuality }: { state: AsyncState<StageDetailResponse>; qualityState: AsyncState<BuildQualityResponse>; qualityStatus: ReturnType<typeof summarizeQuality>; qualityResults: ReturnType<typeof qualityResultsForSource>; onOpenQuality: () => void }) {
  const { t } = useTranslation();
  if (state.status === "loading" || state.status === "idle") return <Card><Skeleton className="h-40 w-full" /></Card>;
  if (state.status === "error" || !state.data) return <Card variant="error" role="alert">{state.error}</Card>;
  // A withheld sample (#642) is a policy notice, not "no preview": the rows exist but do not leave Builder.
  if (state.data.stage !== "silver" || state.data.sample.length === 0) return <StageSampleEmpty stage={state.data.stage} withheld={state.data.stage === "silver" ? state.data.sample_withheld : undefined} />;
  const columns = [...new Set(state.data.sample.flatMap((row) => Object.keys(row)))];
  // Without a warehouse there is no snapshot to page: this is the run's stored stage sample,
  // so it says "N rows · sample" and offers no paging (#537). The stage's own row count
  // is a run figure, not this table's, and is not put beside it as a total.
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]"><div className="min-w-0 space-y-2"><div><h3 className="text-sm font-semibold">{t("addData.preview.sampleTitle")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("datasetDetail.previewNote")}</p></div><DataTable columnMeta={state.data.schema} columns={columns} maskedColumns={state.data.masked_columns} rowTotal={{ returned: state.data.sample.length, total: null, status: "sample" }} rows={state.data.sample} /></div><Card><h3 className="text-sm font-semibold">{t("labels.validation")}</h3><div className="mt-4 text-2xl font-bold"><QualityBadge status={qualityStatus} /></div><div className="mt-4 space-y-3">{qualityState.status === "error" ? <p className="text-sm text-status-failure">{t("datasetDetail.fetchFailed")}</p> : qualityResults.length === 0 ? <p className="text-sm text-muted-foreground">{t("datasetDetail.noEvaluated")}</p> : qualityResults.slice(0, 5).map((result, index) => <div key={`${result.rule}-${index}`} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0"><span>{result.category}</span><QualityBadge status={result.status.toUpperCase() as "PASS" | "WARN" | "FAIL"} /></div>)}</div><Button className="mt-4 w-full" variant="secondary" onClick={onOpenQuality}>{t("datasetDetail.viewQualityDetail")}</Button></Card></div>;
}
