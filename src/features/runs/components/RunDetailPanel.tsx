/**
 * Builds detail panel — Pipeline/Stage Progress, Quality, failure evidence,
 * and Artifacts/Dataset navigation for the selected run (split from
 * BuildsPage in #379).
 *
 * Each surface holds its own state independently, so one failing does not
 * hide the others (#255 §8/§13).
 */
import { keysWereLost } from "@/shared/lib/missingProviderKey";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@/features/datasets/model";
import { QualityBadge, QualityStateBadge } from "@/features/quality/QualityBadge";
import {
  flattenQualityResults,
  flattenSchemaDrift,
  formatQualityValue,
  overallQualityState,
  summarizeChecksPassed,
  warnOrFailResults,
} from "@/features/quality/model";
import {
  collectFailureEvidence,
  summarizeMultiSourceOutcome,
  failQualityResults,
  failedRunEvents,
} from "@/features/runs/model";
import type { AsyncState } from "@/features/runs/asyncState";
import { extractDatasetId, mapLiveStatus, normalizeBuildContextSearch } from "@/features/runs/buildContext";
import { useStageDetails } from "@/features/runs/stageDetails";
import { CancelRunButton } from "@/features/runs/components/CancelRunButton";
import { EventTimeline } from "@/features/runs/components/EventTimeline";
import { KeysLostCard } from "@/features/runs/components/KeysLostCard";
import { SplitAlgorithmCard } from "@/features/runs/components/SplitAlgorithmCard";
import { AssistantRunAnalysis } from "@/features/runs/components/AssistantRunAnalysis";
import {
  MultiSourceOutcomeBadge,
  SourcePipelineRow,
} from "@/features/runs/components/SourcePipeline";
import type { RunEventsState } from "@/features/runs/useRunEvents";
import { useSelectedRunPolling } from "@/features/runs/useSelectedRunPolling";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { useAssistConfig } from "@/features/assistant/config";
import type {
  BuildQualityResponse,
  BuildSpecSnapshotResponse,
  RunStagesResponse,
} from "@/shared/lib/builderApi";
import type { BuildListItem, BuildRunStatus } from "@/shared/lib/types";
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  Skeleton,
  StageLegend,
  StatusBadge,
} from "@/shared/ui";

export function RunDetailPanel({
  runId,
  listItem,
  outOfListScope,
  stagesState,
  qualityState,
  specState,
  eventsState,
  live,
}: {
  runId: string;
  listItem: BuildListItem | null;
  outOfListScope: boolean;
  stagesState: AsyncState<RunStagesResponse>;
  qualityState: AsyncState<BuildQualityResponse>;
  specState: AsyncState<BuildSpecSnapshotResponse>;
  eventsState: RunEventsState;
  live: ReturnType<typeof useSelectedRunPolling>;
}) {
  const { t } = useTranslation();
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);
  const seedAssistantQuestion = useAssistantStore((state) => state.seedQuestion);
  const { isConfigured } = useAssistConfig();
  const [searchParams] = useSearchParams();

  // "Analyze this Run" no longer auto-opens the global Assistant drawer (#255
  // §2) — instead it expands an inline card right under this Run summary.
  // Switching runs closes the card so the previous run's analysis never
  // looks valid in the new run's context (same principle as the #256
  // stale-context guard).
  const [showAssistantAnalysis, setShowAssistantAnalysis] = useState(false);
  // "This analysis click was accepted but not yet seeded" state. Held
  // until the URL context becomes canonical. One click = one flag set = one
  // seed. Discarded when the run changes.
  const [analyzePending, setAnalyzePending] = useState(false);

  useEffect(() => {
    setShowAssistantAnalysis(false);
    setAnalyzePending(false);
  }, [runId]);

  const analyzeQuestion = t("builds.detail.analyzeQuestion", { id: runId });

  // "Context is canonical" = the current URL is already a fixed point of
  // normalizeBuildContextSearch. Reuses exactly the same helper and equality
  // check as BuildsPage's normalization effect (no logic duplication). If
  // spec/stages have not settled yet (dataset/stage/source may still be
  // appended), it is not canonical even if it looks like a no-op. Error also
  // counts as settled, preventing an eternal wait.
  const contextCanonical = useMemo(() => {
    const specSettled = specState.status === "loaded" || specState.status === "error";
    const stagesSettled = stagesState.status === "loaded" || stagesState.status === "error";
    if (!specSettled || !stagesSettled) return false;
    return (
      normalizeBuildContextSearch(searchParams, specState, stagesState).toString() ===
      searchParams.toString()
    );
  }, [searchParams, specState, stagesState]);

  // The deferred analysis intent is seeded once the URL is canonical. The
  // pending flag is lowered right before seeding to prevent re-running for
  // the same click (this effect is the sole seeder). The next "Analyze this
  // Run" click sets the flag again, so re-analysis and retry-after-error
  // still work — dedup is "once per click", not "once per run lifetime".
  // (Seeding runs via useAssistantSession's existing pending-seed consumption
  // effect when AssistantRunAnalysis mounts, calling ask() — that path and its
  // atomic consumeSeed are unchanged.)
  useEffect(() => {
    if (!analyzePending || !isConfigured || !contextCanonical) return;
    setAnalyzePending(false);
    seedAssistantQuestion(analyzeQuestion);
  }, [analyzePending, isConfigured, contextCanonical, analyzeQuestion, seedAssistantQuestion]);

  const sources = stagesState.status === "loaded" ? stagesState.data.sources : [];
  const outcome = stagesState.status === "loaded" ? summarizeMultiSourceOutcome(sources) : "unavailable";
  const failureEvidence = stagesState.status === "loaded" ? collectFailureEvidence(sources) : [];
  const stageDetails = useStageDetails(runId, stagesState);
  const goldHasSplits = Object.values(stageDetails).some(
    (entry) => entry.status === "loaded" && entry.data.stage === "gold" && Boolean(entry.data.splits),
  );

  // Never merge a Quality error (request failure) with Builder semantic
  // unavailable (a normal response with no result) into one state (#255
  // follow-up §5). Overall state is computed only when a normal response
  // exists; errors are handled fully separately below via
  // qualityState.status === "error".
  const qualityStatus = qualityState.status === "loaded" ? overallQualityState(qualityState.data) : undefined;
  const qualityFails = qualityState.status === "loaded" ? failQualityResults(qualityState.data) : [];
  const qualityScopedResults = qualityState.status === "loaded" ? flattenQualityResults(qualityState.data) : [];
  const qualityChecksPassed = qualityState.status === "loaded" ? summarizeChecksPassed(qualityScopedResults) : null;
  const qualityIssues = qualityState.status === "loaded" ? warnOrFailResults(qualityScopedResults) : [];
  const qualityDrift = qualityState.status === "loaded" ? flattenSchemaDrift(qualityState.data) : [];
  const qualityData = qualityState.status === "loaded" ? qualityState.data : null;
  const qualitySourceBreakdown = qualityData
    ? Object.keys(qualityData.quality_results).map((sourceKey) => ({
        sourceKey,
        summary: summarizeChecksPassed(flattenQualityResults(qualityData, sourceKey)),
      }))
    : [];
  const events = eventsState.status === "loaded" ? eventsState.data.events : [];
  const failedEvents = failedRunEvents(events);

  // Navigating to Quality Center (#254) uses the same query convention so
  // the current dataset/run context is not lost.
  const datasetId = specState.status === "loaded" ? extractDatasetId(specState.data.spec) : null;
  const qualityCenterHref = `/quality?${new URLSearchParams({
    ...(datasetId ? { dataset: datasetId } : {}),
    run: runId,
  }).toString()}`;

  // Whole-run status: a live job in the registry is the freshest value.
  // Otherwise (historical), trust the list summary (listItem.status) —
  // never recompute run status by mashing stage states together
  // (#255 §6 principle).
  const runStatus: BuildRunStatus | null = live.kind === "job" ? mapLiveStatus(live.job.status) : listItem?.status ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{listItem?.title ?? runId}</h2>
          <StatusBadge status={runStatus} />
          {/* Only a job the live registry reports can be cancelled (#655); history has none. */}
          {live.kind === "job" ? <div className="ml-auto"><CancelRunButton runId={runId} job={live.job} /></div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">{runId}</span>
          {live.kind === "job" && (live.job.status === "queued" || live.job.status === "running" || live.job.status === "cancelling") ? (
            <span className="text-xs text-muted-foreground">{t("builds.detail.refreshing")}</span>
          ) : null}
          {live.kind === "job" && live.job.retry_of ? (
            <span className="text-xs text-muted-foreground" data-retry-of={live.job.retry_of}>
              {t("builds.detail.retryOf")}{" "}
              <Link className="font-mono underline" to={`/refresh-jobs?run=${encodeURIComponent(live.job.retry_of)}`}>
                {live.job.retry_of}
              </Link>
            </span>
          ) : null}
          {live.kind === "error" ? (
            <span className="text-xs text-status-warning">
              {t("builds.detail.refreshFailed")}
            </span>
          ) : null}
          {live.kind === "permission_denied" ? (
            <span className="text-xs text-status-failure">
              {t("builds.detail.refreshForbidden")}
            </span>
          ) : null}
          {outOfListScope ? (
            <span className="text-xs text-muted-foreground">
              {t("builds.detail.outOfScopeDetail")}
            </span>
          ) : null}
          {listItem?.startedAt ? <span className="text-xs text-muted-foreground">{t("builds.detail.startedAt", { time: formatDateTime(listItem.startedAt) })}</span> : null}
          {listItem?.finishedAt ? <span className="text-xs text-muted-foreground">{t("builds.detail.finishedAt", { time: formatDateTime(listItem.finishedAt) })}</span> : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="text-xs font-medium text-brand-text underline" to={`/refresh-jobs/${encodeURIComponent(runId)}/edit`}>
            {t("builds.detail.edit")}
          </Link>
          <Link className="text-xs font-medium text-brand-text underline" to={`/refresh-jobs/${encodeURIComponent(runId)}/run`}>
            {t("builds.detail.run")}
          </Link>
          <Link className="text-xs font-medium text-brand-text underline" to={`/refresh-jobs/${encodeURIComponent(runId)}/artifacts`}>
            {t("builds.detail.artifacts")}
          </Link>
          <Link className="text-xs font-medium text-brand-text underline" to={`/refresh-jobs/${encodeURIComponent(runId)}/publish`}>
            {t("builds.detail.publish")}
          </Link>
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => {
              // The click opens the inline card immediately.
              setShowAssistantAnalysis(true);
              // Without an API Key, do not seed — the pending seed is always
              // consumed by useAssistantSession's ordinary ask(), and ask() raises
              // a no_key error when not isConfigured (#286 follow-up). The
              // inline card still opens so AssistantRunAnalysis can show the
              // no-key notice.
              if (!isConfigured) return;
              // The click only records "the intent to analyze". The actual
              // seed runs once, in the effect above, after the URL becomes
              // canonical — effectively immediate when already canonical.
              // Prevents the race where the turn is pinned to a thin context
              // and immediately goes stale (C1); re-analysis and
              // retry-after-error still work.
              setAnalyzePending(true);
            }}
          >
            {t("builds.detail.analyze")}
          </Button>
        </div>
      </Card>

      {showAssistantAnalysis ? (
        <AssistantRunAnalysis
          onClose={() => {
            setAnalyzePending(false);
            setShowAssistantAnalysis(false);
          }}
          onAskMore={openAssistantDrawer}
        />
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("builds.detail.pipelineTitle")}</h3>
          {stagesState.status === "loaded" ? <MultiSourceOutcomeBadge outcome={outcome} /> : null}
        </div>
        <div className="mt-3"><StageLegend /></div>
        {stagesState.status === "loading" || stagesState.status === "idle" ? (
          <Skeleton className="mt-4 h-24 w-full" />
        ) : stagesState.status === "error" ? (
          <p className="mt-3 text-sm text-status-failure">
            {stagesState.permissionDenied
              ? t("builds.stage.forbidden")
              : stagesState.error}
          </p>
        ) : sources.length === 0 ? (
          <EmptyState title={t("builds.stage.noneTitle")} description={t("builds.stage.noneDesc")} />
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {/* multi-source shows a pipeline row per source — the first source is
                not collapsed into a representative. */}
            {sources.map((source) => (
              <SourcePipelineRow key={source.source_key} source={source} details={stageDetails} />
            ))}
          </div>
        )}
        {qualityState.status === "loaded" && qualityChecksPassed ? (
          // No separate "Validate stage" is invented; Quality appears only
          // as a compact checkpoint continuing the Silver/Gold flow (#255
          // follow-up §6). The Quality card below is the authoritative
          // verdict — this summary just relays it without recomputation.
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t("builds.detail.qualityCheckpoint")}</span>
            <QualityStateBadge state={qualityStatus ?? "NOT_EVALUATED"} />
            <span>
              {qualityChecksPassed.evaluated === 0
                ? t("builds.stage.noEvaluated")
                : `${qualityChecksPassed.pass}/${qualityChecksPassed.evaluated} PASS · WARN ${qualityChecksPassed.warn} · FAIL ${qualityChecksPassed.fail}`}
            </span>
          </div>
        ) : null}
      </Card>

      <SplitAlgorithmCard runId={runId} specState={specState} goldHasSplits={goldHasSplits} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("labels.quality")}</h3>
          <div className="flex items-center gap-2">
            {qualityStatus ? <QualityStateBadge state={qualityStatus} /> : null}
            {qualityState.status === "loaded" ? (
              <span className="text-xs text-muted-foreground">{t("builds.detail.availability", { value: qualityState.data.availability })}</span>
            ) : null}
          </div>
        </div>
        {qualityState.status === "loading" || qualityState.status === "idle" ? (
          <Skeleton className="mt-4 h-16 w-full" />
        ) : qualityState.status === "error" ? (
          // (B) Request failure — never merged into the same state as
          // Builder semantic unavailable (a normal response) (#255 follow-up
          // §5). No UNAVAILABLE badge; only the error message matching
          // 403/404/network/5xx.
          <div className="mt-3">
            <p className="text-sm font-semibold text-status-failure">{t("builds.quality.failedTitle")}</p>
            <p className="mt-1 text-sm text-status-failure">
              {qualityState.permissionDenied
                ? t("builds.quality.forbidden")
                : qualityState.notFound
                  ? t("builds.quality.notFound")
                  : t("builds.quality.loadError", { error: qualityState.error })}
            </p>
          </div>
        ) : qualityState.data.availability === "unavailable" ? (
          // (A) Normal response + availability=unavailable — Builder
          // explicitly answered "no result", not a failed lookup.
          <EmptyState title={t("builds.quality.unavailableTitle")} description={t("builds.quality.unavailableDesc")} />
        ) : qualityState.data.evaluated_checks === 0 ? (
          <EmptyState title={t("builds.quality.noChecksTitle")} description={t("builds.quality.noChecksDesc")} />
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {qualityChecksPassed ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium text-status-success">{qualityChecksPassed.pass} PASS</span>
                <span className="font-medium text-status-warning">{qualityChecksPassed.warn} WARN</span>
                <span className="font-medium text-status-failure">{qualityChecksPassed.fail} FAIL</span>
                <span className="text-xs text-muted-foreground">{t("builds.quality.evaluated", { count: qualityChecksPassed.evaluated })}</span>
              </div>
            ) : null}

            {qualitySourceBreakdown.length > 1 ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-muted-foreground">{t("builds.quality.perSource")}</p>
                {qualitySourceBreakdown.map(({ sourceKey, summary }) => (
                  <div key={sourceKey} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono">{sourceKey}</span>
                    <span className="text-muted-foreground">
                      {summary.evaluated === 0
                        ? t("builds.quality.noEvalResult")
                        : `${summary.pass}/${summary.evaluated} PASS · WARN ${summary.warn} · FAIL ${summary.fail}`}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Avoid listing all PASS details; only WARN/FAIL with their evidence
                (source/category/rule/column/actual/threshold) shown alongside
                (#255 follow-up §1). */}
            {qualityIssues.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {qualityIssues.map((result, index) => (
                  <li
                    key={`${result.source_key}-${result.rule}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-xs last:border-0"
                  >
                    <span>
                      {result.source_key} · {result.category}/{result.rule}
                      {result.column ? ` · ${result.column}` : ""}
                    </span>
                    <span className="flex items-center gap-2">
                      <QualityBadge status={result.status.toUpperCase() as "WARN" | "FAIL"} />
                      <span className="font-mono text-muted-foreground">
                        {t("builds.detail.actualVsThreshold", { actual: formatQualityValue(result.rule, result.actual), threshold: formatQualityValue(result.rule, result.threshold) })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t("builds.quality.noWarnFail")}</p>
            )}

            {qualityDrift.length > 0 ? (
              <p className="text-xs text-status-warning">
                {t("builds.quality.drift", {
                  count: qualityDrift.length,
                  kinds: qualityDrift.map((finding) => finding.kind).join(", "),
                })}
              </p>
            ) : null}

            <Link className="text-xs font-medium text-brand-text underline" to={qualityCenterHref}>
              {t("builds.quality.viewCenter")}
            </Link>
          </div>
        )}
      </Card>

      {live.kind === "job" && keysWereLost(live.job) ? (
        // A run that lost its keys never started, so it has no failure evidence and the
        // card below does not appear for it (#787). The run is over and stays as it
        // ended; what can be done next is the card's to say (#846).
        <KeysLostCard runId={live.job.run_id} />
      ) : null}

      {failureEvidence.length > 0 || qualityFails.length > 0 ? (
        <Card variant="error">
          <h3 className="text-sm font-semibold">{t("builds.detail.failureEvidence")}</h3>
          {failureEvidence.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {failureEvidence.map((item) => (
                <li key={item.sourceKey}>
                  <strong>{item.sourceKey}</strong> — {t("builds.detail.failedStages", { failed: item.failedStage ?? t("builds.detail.stageUnknown"), completed: item.lastCompletedStage ?? t("builds.detail.stageNone") })}
                </li>
              ))}
            </ul>
          ) : null}
          {listItem?.status === "failed" && live.kind === "job" && live.job.error ? (
            <p className="mt-2 text-sm">{t("builds.detail.builderError", { error: live.job.error })}</p>
          ) : null}
          {qualityFails.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {qualityFails.map((result, index) => (
                <li key={`${result.source_key}-${result.rule}-${index}`}>
                  FAIL · {result.source_key} · {result.category}/{result.rule}
                  {result.column ? ` · ${t("labels.column")} ${result.column}` : ""} · {t("builds.detail.actualVsThresholdFailed", { actual: JSON.stringify(result.actual), threshold: JSON.stringify(result.threshold) })}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Disclosure
          title={
            <span className="flex flex-1 flex-wrap items-center gap-2">
              {t("builds.detail.runEvents")}{eventsState.status === "loaded" ? ` (${events.length})` : ""}
              {failedEvents.length > 0 ? (
                <span className="rounded-full bg-status-failure-subtle px-2 py-0.5 text-xs font-medium text-status-failure">
                  {t("builds.events.failedCount", { count: failedEvents.length })}
                </span>
              ) : null}
            </span>
          }
        >
          <p className="text-xs text-muted-foreground">
            {t("builds.events.note")}
          </p>
          {eventsState.status === "loading" || eventsState.status === "idle" ? (
            <Skeleton className="mt-4 h-24 w-full" />
          ) : eventsState.status === "error" ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {eventsState.mockUnsupported
                ? eventsState.error
                : eventsState.notFound
                  ? t("builds.events.notFound")
                  : eventsState.permissionDenied
                    ? t("builds.events.forbidden")
                    : t("builds.events.loadError", { error: eventsState.error })}
            </p>
          ) : (
            <EventTimeline events={events} />
          )}
        </Disclosure>
      </Card>

      <Card>
        <Disclosure title={t("builds.detail.specSnapshot")}>
          {specState.status === "loading" || specState.status === "idle" ? (
            <Skeleton className="h-10 w-full" />
          ) : null}
          {specState.status === "error" ? (
            <p className="text-sm text-muted-foreground">
              {specState.permissionDenied
                ? t("builds.spec.forbidden")
                : specState.error}
            </p>
          ) : specState.status === "loaded" ? (
            <div className="text-sm">
              <p className="text-xs text-muted-foreground">{t("builds.detail.digest", { digest: specState.data.spec_digest })}</p>
              {datasetId ? (
                <Link
                  className="mt-2 inline-block text-xs font-medium text-brand-text underline"
                  to={`/tables/${encodeURIComponent(datasetId)}`}
                >
                  {t("builds.spec.viewDataset", { id: datasetId })}
                </Link>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {t("builds.spec.note")}
              </p>
            </div>
          ) : null}
        </Disclosure>
      </Card>
    </div>
  );
}
