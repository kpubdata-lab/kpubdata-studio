/**
 * Quality Center page (`/quality`, #254).
 *
 * Displays only actual evaluated quality results returned by Builder
 * (PASS/WARN/FAIL/availability/evaluated_checks). Studio doesn't create new scores or
 * re-judge PASS/WARN/FAIL (#246 principle). Dataset/Run/Source reuse the same API·URL
 * pattern (#253, Dataset Detail: ?run=&source=&stage=) to keep context across screens.
 */
import { useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getBuildQuality,
  getDatasetQualityHistory,
  listBuildStages,
  listDatasetRuns,
  listDatasets,
} from "@/features/datasets/api";
import { DATASET_STAGES, formatDateTime, type DatasetStage } from "@/features/datasets/model";
import { useRequestedRun } from "@/features/datasets/useRequestedRun";
import { QualityBadge, QualityStateBadge } from "@/features/quality/QualityBadge";
import {
  flattenQualityResults,
  flattenSchemaDrift,
  formatQualityValue,
  groupByCategory,
  isDuplicateCategory,
  isMissingCategory,
  isSchemaCategory,
  overallQualityState,
  qualityAssistantSeedQuestion,
  summarizeByCategory,
  summarizeChecksPassed,
  warnOrFailResults,
  type CategorySummary,
} from "@/features/quality/model";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { useUIStore } from "@/shared/hooks/useUIStore";
import type {
  BuildQualityResponse,
  DatasetQualityHistoryResponse,
  DatasetRunSummary,
  DatasetSummary,
  QualityCheckResult,
  RunStagesResponse,
  SchemaDriftFinding,
} from "@/shared/lib/builderApi";
import { Button, Card, EmptyState, ErrorState, PageHeader, QualityLegend, Skeleton, TermHelp } from "@/shared/ui";

interface AsyncState<T> {
  status: "idle" | "loading" | "loaded" | "error";
  data?: T;
  error?: string;
}

const selectClassName =
  "h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Row count field (affected_rows/evaluated_rows) shown as-is, not converted to 0 without N/A. */
function formatRowCount(value: number | null, t: (k: string) => string): string {
  return value === null ? "N/A" : `${value.toLocaleString("ko-KR")}${t("quality.rowsUnit")}`;
}

function describeWorst(summary: CategorySummary): string {
  if (summary.evaluated === 0) return i18n.t("quality.noRules");
  const worst = summary.worst;
  if (!worst) return `${summary.pass}/${summary.evaluated} PASS`;
  return `${worst.column ?? worst.rule} · actual ${formatQualityValue(worst.rule, worst.actual)} (threshold ${formatQualityValue(worst.rule, worst.threshold)})`;
}

function MetricCard({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </Card>
  );
}

export function QualityPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);
  const seedAssistantQuestion = useAssistantStore((state) => state.seedQuestion);

  const [datasetsState, setDatasetsState] = useState<AsyncState<DatasetSummary[]>>({ status: "loading" });
  const [runsState, setRunsState] = useState<AsyncState<DatasetRunSummary[]>>({ status: "idle" });
  const [stagesState, setStagesState] = useState<AsyncState<RunStagesResponse>>({ status: "idle" });
  const [qualityState, setQualityState] = useState<AsyncState<BuildQualityResponse>>({ status: "idle" });
  const [historyState, setHistoryState] = useState<AsyncState<DatasetQualityHistoryResponse>>({ status: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    setDatasetsState({ status: "loading" });
    listDatasets(100, controller.signal)
      .then((datasets) => setDatasetsState({ status: "loaded", data: datasets }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setDatasetsState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("quality.errors.datasets") });
      });
    return () => controller.abort();
  }, []);

  const requestedDatasetId = searchParams.get("dataset");
  const invalidDataset = Boolean(
    requestedDatasetId && datasetsState.status === "loaded" && !datasetsState.data?.some((dataset) => dataset.dataset_id === requestedDatasetId),
  );
  const selectedDatasetId = requestedDatasetId || datasetsState.data?.[0]?.dataset_id || "";
  const selectedDataset = datasetsState.data?.find((dataset) => dataset.dataset_id === selectedDatasetId);

  useEffect(() => {
    if (!selectedDatasetId || invalidDataset) {
      setRunsState({ status: "idle" });
      setHistoryState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setRunsState({ status: "loading" });
    setHistoryState({ status: "loading" });
    listDatasetRuns(selectedDatasetId, 50, controller.signal)
      .then((data) => setRunsState({ status: "loaded", data: data.runs }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setRunsState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("quality.errors.runs") });
      });
     // Trend (history) fetch succeeds/fails independently from current-run quality — states
     // don't clear each other.
    getDatasetQualityHistory(selectedDatasetId, 30, controller.signal)
      .then((data) => setHistoryState({ status: "loaded", data }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setHistoryState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("quality.errors.history") });
      });
    return () => controller.abort();
  }, [selectedDatasetId, invalidDataset]);

  const requestedRunId = searchParams.get("run");
  // Not being in the newest page does not make a run invalid (#418); Builder is asked directly.
  const requested = useRequestedRun(selectedDatasetId, requestedRunId, runsState.status === "loaded" ? runsState.data : undefined);
  const invalidRun = requested.status === "not_found" || requested.status === "forbidden" || requested.status === "error";
  const runPending = requested.status === "loading" && runsState.status === "loaded";
  const runOptions =
    requested.status === "available" && !requested.inPage && runsState.data ? [...runsState.data, requested.run] : runsState.data;
  const selectedRunId = requestedRunId || selectedDataset?.latest_run_id || "";
  const selectedRun = runOptions?.find((run) => run.run_id === selectedRunId);

   // Assistant (AssistantContent) reads context only from the route's `?dataset=&run=&source=&stage=`
   // (context.ts, no-guess principle). Screen shows fallback with calculated dataset/run,
   // but if URL lacks them, AssistantContext doesn't receive them and returns "tell me which
   // dataset/run" (#319 follow-up). So reflect the fallback-confirmed selection back to
   // URL to sync UI selection and AssistantContext SSOT. Update via replace only to not pollute
   // history; skip for invalid dataset/run.
  useEffect(() => {
    if (datasetsState.status !== "loaded" || invalidDataset || invalidRun || runPending) return;
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (!requestedDatasetId && selectedDatasetId) {
      next.set("dataset", selectedDatasetId);
      changed = true;
    }
    if (!requestedRunId && selectedRunId) {
      next.set("run", selectedRunId);
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [
    datasetsState.status,
    invalidDataset,
    invalidRun,
    runPending,
    requestedDatasetId,
    selectedDatasetId,
    requestedRunId,
    selectedRunId,
    searchParams,
    setSearchParams,
  ]);

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
        if (!controller.signal.aborted) setStagesState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("quality.errors.stages") });
      });
    getBuildQuality(selectedRunId, controller.signal)
      .then((data) => setQualityState({ status: "loaded", data }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setQualityState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("quality.errors.quality") });
      });
    return () => controller.abort();
  }, [selectedRunId, invalidRun, runPending]);

  const sourceEntries = stagesState.data?.sources ?? [];
  const requestedSource = searchParams.get("source") ?? "";
  const invalidSource = Boolean(requestedSource && stagesState.status === "loaded" && !sourceEntries.some((source) => source.source_key === requestedSource));
   const selectedSource = requestedSource; // "" == all sources (explicitly valid selection)
  const selectedSourceEntry = sourceEntries.find((source) => source.source_key === selectedSource);

  const requestedStage = searchParams.get("stage");
  const selectedStage = DATASET_STAGES.includes(requestedStage as DatasetStage) ? (requestedStage as DatasetStage) : undefined;

  function updateContext(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next);
  }

  // Before opening Ask KPubData, sync the dataset/run/source/stage shown on screen to
  // the URL — AssistantContext reads route only (context.ts), so without this sync the drawer
  // only receives catalog-level evidence (#319 follow-up). Header button and per-issue
  // "Explain this issue" share this helper.
  function syncAssistantContext() {
    updateContext({
      dataset: selectedDatasetId || null,
      run: selectedRunId || null,
      source: selectedSource || null,
      stage: selectedStage ?? null,
    });
  }

  const scopedResults = useMemo(
    () => flattenQualityResults(qualityState.data, selectedSource || undefined),
    [qualityState.data, selectedSource],
  );
  const scopedDrift = useMemo(
    () => flattenSchemaDrift(qualityState.data, selectedSource || undefined),
    [qualityState.data, selectedSource],
  );
  const checksPassed = useMemo(() => summarizeChecksPassed(scopedResults), [scopedResults]);
  const missingSummary = useMemo(() => summarizeByCategory(scopedResults, isMissingCategory), [scopedResults]);
  const duplicateSummary = useMemo(() => summarizeByCategory(scopedResults, isDuplicateCategory), [scopedResults]);
  const schemaRuleSummary = useMemo(() => summarizeByCategory(scopedResults, isSchemaCategory), [scopedResults]);
  const overallState = useMemo(() => overallQualityState(qualityState.data, selectedSource || undefined), [qualityState.data, selectedSource]);
  const categoryGroups = useMemo(() => groupByCategory(scopedResults), [scopedResults]);
  const issues = useMemo(() => warnOrFailResults(scopedResults), [scopedResults]);

  const scopeLabel = selectedSource || t("quality.allSources");
   // Composite context string showing "which Dataset/Run/Source/Stage" for Rule Pass Rate /
   // Recent Issues / Schema Drift to always be clear (#254 review §3, §7).
  const contextLabel = [
    selectedDataset ? `Table: ${selectedDataset.title}` : null,
    selectedRunId ? `Run: ${selectedRunId}` : null,
    `Source: ${scopeLabel}`,
    selectedStage ? `Stage: ${selectedStage}` : null,
  ].filter(Boolean).join(" · ");

   // Show which sources have actual evaluated results (don't hide zero-count sources) —
   // avoid collapsing "some sources only evaluation complete" into the first source value
   // (#254 review §1, §8).
  const knownSourceKeys = useMemo(() => {
    const fromStages = sourceEntries.map((source) => source.source_key);
    const fromQuality = Object.keys(qualityState.data?.quality_results ?? {});
    return Array.from(new Set([...fromStages, ...fromQuality]));
  }, [sourceEntries, qualityState.data]);
  const sourceBreakdown = useMemo(
    () => knownSourceKeys.map((sourceKey) => ({
      sourceKey,
      summary: summarizeChecksPassed(flattenQualityResults(qualityState.data, sourceKey)),
    })),
    [knownSourceKeys, qualityState.data],
  );

  const datasetDetailHref = selectedDatasetId
    ? `/datasets/${encodeURIComponent(selectedDatasetId)}?${new URLSearchParams({
        ...(selectedRunId ? { run: selectedRunId } : {}),
        ...(selectedSource ? { source: selectedSource } : {}),
        ...(selectedStage ? { stage: selectedStage } : {}),
        tab: "quality",
      }).toString()}`
    : undefined;

  if (datasetsState.status === "loading") {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader eyebrow="Quality" title="Quality Center" description={t("quality.loading")} />
        <Card><Skeleton className="h-40 w-full" /></Card>
      </main>
    );
  }

  if (datasetsState.status === "error") {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader eyebrow="Quality" title="Quality Center" />
        <ErrorState title={t("quality.errors.datasets")} message={datasetsState.error} />
      </main>
    );
  }

  if (!datasetsState.data || datasetsState.data.length === 0) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader eyebrow="Quality" title="Quality Center" />
        <Card><EmptyState title={t("quality.empty.title")} description={t("quality.empty.desc")} actionLabel={t("quality.empty.action")} actionHref="/add" /></Card>
      </main>
    );
  }

  if (invalidDataset) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader eyebrow="Quality" title="Quality Center" />
        <Card variant="error" role="alert">
          <p className="font-semibold">{t("quality.wrongDataset.title")}</p>
          <p className="mt-2 text-sm">{t("quality.wrongDataset.desc", { id: requestedDatasetId })}</p>
          <Button className="mt-4" variant="secondary" onClick={() => updateContext({ dataset: null, run: null, source: null, stage: null })}>{t("quality.wrongDataset.back")}</Button>
        </Card>
      </main>
    );
  }

  if (invalidRun) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader eyebrow="Quality" title="Quality Center" description={selectedDataset?.title} />
        <Card variant="error" role="alert">
          <p className="font-semibold">{t(requested.status === "forbidden" ? "quality.wrongRun.forbiddenTitle" : requested.status === "error" ? "quality.wrongRun.checkFailedTitle" : "quality.wrongRun.title")}</p>
          <p className="mt-2 text-sm">{t(requested.status === "forbidden" ? "quality.wrongRun.forbiddenDesc" : requested.status === "error" ? "quality.wrongRun.checkFailedDesc" : "quality.wrongRun.desc", { id: requestedRunId })}</p>
          <Button className="mt-4" variant="secondary" onClick={() => updateContext({ run: null, source: null, stage: null })}>{t("quality.wrongRun.back")}</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader
        eyebrow="Quality"
        title="Quality Center"
        description={t("quality.header.desc")}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              syncAssistantContext();
              seedAssistantQuestion(qualityAssistantSeedQuestion(checksPassed));
              openAssistantDrawer();
            }}
          >
            {t("quality.assistantAnalyze")}
          </Button>
        }
      />

      <QualityLegend />

      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-52 flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Dataset
          <select aria-label={t("quality.selectors.dataset")} className={`mt-1 w-full ${selectClassName}`} value={selectedDatasetId} onChange={(event) => updateContext({ dataset: event.target.value, run: null, source: null, stage: null })}>
            {datasetsState.data.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.title}</option>)}
          </select>
        </label>
        <label className="min-w-52 flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Run
          <select aria-label={t("quality.selectors.run")} className={`mt-1 w-full ${selectClassName}`} value={selectedRunId} disabled={runsState.status !== "loaded"} onChange={(event) => updateContext({ run: event.target.value === selectedDataset?.latest_run_id ? null : event.target.value, source: null, stage: null })}>
            {(runOptions ?? []).map((run) => <option key={run.run_id} value={run.run_id}>{run.run_id}{run.run_id === selectedDataset?.latest_run_id ? " (latest)" : ""}</option>)}
          </select>
        </label>
        <label className="min-w-52 flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Source
          <select aria-label={t("quality.selectors.source")} className={`mt-1 w-full ${selectClassName}`} value={selectedSource} disabled={stagesState.status !== "loaded"} onChange={(event) => updateContext({ source: event.target.value || null, stage: null })}>
            <option value="">{t("quality.allSources")}</option>
            {sourceEntries.map((source) => <option key={source.source_key} value={source.source_key}>{source.source_key}</option>)}
          </select>
        </label>
        <label className="min-w-44 flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Stage
          <select aria-label={t("quality.selectors.stage")} className={`mt-1 w-full ${selectClassName}`} value={selectedStage ?? ""} disabled={!selectedSourceEntry} onChange={(event) => updateContext({ stage: event.target.value || null })}>
            <option value="">{t("quality.selectors.stageOption")}</option>
            {DATASET_STAGES.map((stageName) => <option key={stageName} value={stageName}>{stageName}{selectedSourceEntry ? ` · ${selectedSourceEntry[stageName].status}` : ""}</option>)}
          </select>
        </label>
        <div className="flex min-h-9 flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
          <span>Run status</span><strong className="text-foreground">{selectedRun?.status ?? "—"}</strong>
          <span>·</span><span>Availability</span><strong className="text-foreground">{qualityState.data?.availability ?? "—"}</strong>
          <QualityStateBadge state={overallState} />
        </div>
        <p className="basis-full text-xs text-muted-foreground">{t("quality.scope.desc")} <TermHelp term="quality" /></p>
        {datasetDetailHref && selectedSource ? <Link className="ml-auto text-xs font-medium text-accent-subtle-foreground underline" to={datasetDetailHref}>{t("quality.scope.viewDetail")}</Link> : null}
      </Card>

      {stagesState.status === "error" ? <Card variant="error" role="alert">{stagesState.error}</Card> : null}

      {qualityState.status === "error" ? (
        <Card variant="error" role="alert">
          <p className="font-semibold">{t("quality.failed.title")}</p>
          <p className="mt-2 text-sm">{qualityState.error}</p>
        </Card>
      ) : invalidSource ? (
        <Card variant="error" role="alert">
          <p className="font-semibold">{t("quality.wrongSource.title")}</p>
          <p className="mt-2 text-sm">{t("quality.wrongSource.desc", { id: requestedSource })}</p>
          <Button className="mt-4" variant="secondary" onClick={() => updateContext({ source: null, stage: null })}>{t("quality.wrongSource.reset")}</Button>
        </Card>
      ) : qualityState.status === "loading" || qualityState.status === "idle" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Card key={index} className="p-5"><Skeleton className="h-16 w-full" /></Card>)}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Checks Passed" value={checksPassed.evaluated === 0 ? "N/A" : `${checksPassed.pass} / ${checksPassed.evaluated}`} sub={checksPassed.evaluated === 0 ? t("quality.metrics.noRulesSub") : `${checksPassed.warn} WARN · ${checksPassed.fail} FAIL · ${t("quality.metrics.scopeBase", { scope: scopeLabel })}`} />
            <MetricCard label="Missing" value={<QualityBadge status={missingSummary.status} />} sub={describeWorst(missingSummary)} />
            <MetricCard label="Duplicates" value={<QualityBadge status={duplicateSummary.status} />} sub={describeWorst(duplicateSummary)} />
            <MetricCard label="Schema" value={<QualityBadge status={schemaRuleSummary.status} />} sub={t("quality.metrics.schemaSub", { evaluated: schemaRuleSummary.evaluated, drift: scopedDrift.length })} />
          </div>

          {selectedSource === "" && sourceBreakdown.length > 1 ? <SourceBreakdown rows={sourceBreakdown} /> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <ValidationTrend state={historyState} />
            <RulePassRate groups={categoryGroups} contextLabel={contextLabel} />
          </div>

          <RecentIssues
            issues={issues}
            evaluatedTotal={scopedResults.length}
            contextLabel={contextLabel}
            selectedRun={selectedRun}
            onAssistant={(issue) => {
              syncAssistantContext();
              seedAssistantQuestion(t("quality.assistantQuestion", { category: issue.category, rule: issue.rule, status: issue.status.toUpperCase() }));
              openAssistantDrawer();
            }}
          />

          <SchemaDriftCard drift={scopedDrift} contextLabel={contextLabel} />
        </>
      )}
    </main>
  );
}

/** When querying all sources, don't collapse "some sources only evaluation complete" into
    the first source value (#254 review §1, §8). */
function SourceBreakdown({ rows }: { rows: { sourceKey: string; summary: ReturnType<typeof summarizeChecksPassed> }[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <h3 className="text-sm font-semibold">{t("quality.perSource.title")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("quality.perSource.desc")}</p>
      <div className="mt-4 flex flex-col">
        {rows.map(({ sourceKey, summary }) => (
          <div key={sourceKey} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
            <span className="font-mono text-xs">{sourceKey}</span>
            {summary.evaluated === 0 ? (
              <span className="text-xs text-muted-foreground">{t("quality.perSource.noResult")}</span>
            ) : (
              <span className="text-xs text-muted-foreground">{summary.pass} / {summary.evaluated} PASS · WARN {summary.warn} · FAIL {summary.fail}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ValidationTrend({ state }: { state: AsyncState<DatasetQualityHistoryResponse> }) {
  const { t } = useTranslation();
  return (
    <Card>
      <h3 className="text-sm font-semibold">Validation trend</h3>
      {state.status === "loading" || state.status === "idle" ? (
        <Skeleton className="mt-4 h-40 w-full" />
      ) : state.status === "error" ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{t("quality.history.fail", { error: state.error })}</p>
      ) : (state.data?.runs.length ?? 0) === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("quality.history.empty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr><th className="py-2 pr-3">Run</th><th className="py-2 pr-3">{t("quality.history.cols.time")}</th><th className="py-2 pr-3">{t("quality.history.cols.distribution")}</th><th className="py-2 pr-3">Evaluated</th><th className="py-2 pr-3">{t("quality.history.cols.rows")}</th><th className="py-2 pr-3">Pass rate</th></tr>
            </thead>
            <tbody>
              {state.data!.runs.map((run) => {
                const total = run.pass_count + run.warn_count + run.fail_count;
                return (
                  <tr key={run.run_id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3"><Link className="font-mono text-xs text-accent-subtle-foreground underline" to={`/builds/${encodeURIComponent(run.run_id)}`}>{run.run_id}</Link><div className="text-xs text-muted-foreground">{run.status}{run.status === "failed" ? t("quality.history.buildFailed") : ""}</div></td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{formatDateTime(run.timestamp)}</td>
                    <td className="py-2 pr-3">
                      {total === 0 ? <span className="text-xs text-muted-foreground">N/A</span> : (
                        <div className="flex h-2 w-32 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <span className="h-full bg-emerald-500 dark:bg-emerald-600" style={{ width: `${(run.pass_count / total) * 100}%` }} />
                          <span className="h-full bg-amber-500 dark:bg-amber-600" style={{ width: `${(run.warn_count / total) * 100}%` }} />
                          <span className="h-full bg-red-500 dark:bg-red-600" style={{ width: `${(run.fail_count / total) * 100}%` }} />
                        </div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">PASS {run.pass_count} · WARN {run.warn_count} · FAIL {run.fail_count}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{run.evaluated_checks}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{formatRowCount(run.validated_rows, t)}</td>
                    <td className="py-2 pr-3 text-xs">{run.rule_pass_rate === null ? "N/A" : `${Math.round(run.rule_pass_rate * 1000) / 10}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">{t("quality.history.note")}</p>
        </div>
      )}
    </Card>
  );
}

function RulePassRate({ groups, contextLabel }: { groups: { category: string; results: QualityCheckResult[] }[]; contextLabel: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <h3 className="text-sm font-semibold">Rule pass rate</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("quality.rules.context", { context: contextLabel })}</p>
      {groups.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("quality.rules.noRules")}</p>
      ) : (
        <div className="mt-4 flex flex-col">
          {groups.map(({ category, results }) => {
            const summary = summarizeChecksPassed(results);
            return (
              <div key={category} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
                <span>{category}</span>
                <span className="font-mono text-xs text-muted-foreground">{summary.pass} / {summary.evaluated} ({Math.round((summary.pass / summary.evaluated) * 100)}%)</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function RecentIssues({ issues, evaluatedTotal, contextLabel, selectedRun, onAssistant }: { issues: QualityCheckResult[]; evaluatedTotal: number; contextLabel: string; selectedRun?: DatasetRunSummary; onAssistant: (issue: QualityCheckResult) => void }) {
  const { t } = useTranslation();
  const runTimestamp = formatDateTime(selectedRun?.finished_at ?? selectedRun?.started_at);
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-sm font-semibold">Recent quality issues</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("quality.rules.contextWarnFail", { context: contextLabel })}</p>
      </div>
      {evaluatedTotal === 0 ? (
        <EmptyState title={t("quality.rules.emptyTitle")} description={t("quality.rules.emptyDesc")} />
      ) : issues.length === 0 ? (
        <EmptyState title={t("quality.rules.allPassTitle")} description={t("quality.rules.allPassDesc")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-3">Run</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Category · Rule</th><th className="px-4 py-3">Column</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actual</th><th className="px-4 py-3">Threshold</th><th className="px-4 py-3">Affected / Evaluated</th><th className="px-4 py-3">Detail</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {issues.map((result, index) => (
                <tr key={`${result.source_key}-${result.rule}-${index}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-3"><span className="font-mono text-xs">{selectedRun?.run_id ?? "—"}</span><div className="text-xs text-muted-foreground">{runTimestamp}</div></td>
                  <td className="px-4 py-3 font-mono text-xs">{result.source_key}</td>
                  <td className="px-4 py-3 font-medium">{result.category} · {result.rule}</td>
                  <td className="px-4 py-3">{result.column ?? "—"}</td>
                  <td className="px-4 py-3"><QualityBadge status={result.status.toUpperCase() as "PASS" | "WARN" | "FAIL"} /></td>
                  <td className="px-4 py-3 font-mono text-xs">{formatQualityValue(result.rule, result.actual)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{formatQualityValue(result.rule, result.threshold)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{formatRowCount(result.affected_rows, t)} / {formatRowCount(result.evaluated_rows, t)}</td>
                  <td className="px-4 py-3 max-w-64 truncate text-xs text-muted-foreground">{result.detail ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {selectedRun ? <Link className="text-xs font-medium text-accent-subtle-foreground underline" to={`/builds/${encodeURIComponent(selectedRun.run_id)}`}>{t("quality.rules.viewBuild")}</Link> : null}
                      <Button variant="ghost" size="sm" onClick={() => onAssistant(result)}>{t("quality.assistantAnalyze")}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SchemaDriftCard({ drift, contextLabel }: { drift: SchemaDriftFinding[]; contextLabel: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <h3 className="text-sm font-semibold">Schema Drift</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("quality.drift.context", { context: contextLabel })}</p>
      {drift.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("quality.drift.empty")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {drift.map((finding, index) => (
            <div key={`${finding.kind}-${index}`} className="flex items-start justify-between gap-3 border-b border-border pb-3 text-sm last:border-0">
              <div><strong>{finding.kind}</strong><p className="mt-1 text-xs text-muted-foreground">{finding.detail}</p></div>
              <span className="font-mono text-xs">{finding.column ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
