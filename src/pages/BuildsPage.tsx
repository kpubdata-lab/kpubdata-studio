/**
 * Builds / Runs master-detail screen (`/builds`, `/builds?run=<id>`, legacy `/builds/:buildId`, #255).
 *
 * Top KPI → Run list (master) → selected Run detail (Pipeline/Stage Progress, Quality, Failure
 * evidence, Artifacts/Dataset navigation) structure displays Builder state as-is.
 * Studio never recalculates or guesses values returned by Builder (#246 principle).
 *
 * This file handles **screen assembly only** (#379). Components live under `features/runs` —
 * list/detail panels and pipeline are in `components/`, URL context/stage detail/async state are in
 * `buildContext.ts`/`stageDetails.ts`/`asyncState.ts` respectively.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";

import { getBuildQuality, listBuildStages } from "@/features/datasets/api";
import { computeBuildKpi, matchesSearch, matchesStatusFilter, type RunStatusFilter } from "@/features/runs/model";
import { isTerminalBuilderStatus, listBuilds } from "@/features/runs/api";
import { getBuildSpecSnapshot } from "@/features/runs/api/runDetail";
import { useAsync, type AsyncState } from "@/features/runs/asyncState";
import { normalizeBuildContextSearch } from "@/features/runs/buildContext";
import { KpiRow } from "@/features/runs/components/KpiRow";
import { RunDetailPanel } from "@/features/runs/components/RunDetailPanel";
import { RunListPanel } from "@/features/runs/components/RunListPanel";
import { useSelectedRunPolling } from "@/features/runs/useSelectedRunPolling";
import { useRunEvents } from "@/features/runs/useRunEvents";
import type {
  BuildQualityResponse,
  BuildSpecSnapshotResponse,
  RunStagesResponse,
} from "@/shared/lib/builderApi";
import { isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { BuildListItem } from "@/shared/lib/types";
import { Card, EmptyState, PageHeader, TermHelp } from "@/shared/ui";

/** `/builds` request scope. Builder has no total count, so KPI must be calculated within this value only. */
const LIST_LIMIT = 100;

export function BuildsPage() {
  const { t } = useTranslation();
  const { buildId: legacyRunId } = useParams<{ buildId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [listState, setListState] = useState<AsyncState<BuildListItem[]>>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>("all");

  const loadList = useCallback(() => {
    const controller = new AbortController();
    setListState({ status: "loading" });
    listBuilds(LIST_LIMIT)
      .then((items) => {
        if (!controller.signal.aborted) setListState({ status: "loaded", data: items });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setListState({
          status: "error",
          error: cause instanceof Error ? cause.message : t("builds.errors.loadListFallback"),
        });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => loadList(), [loadList]);

  // New canonical form is ?run=. Legacy /builds/:buildId deep-link also opens same context (#255 §5).
  // If both exist, canonical (?run=) takes priority.
  const selectedRunId = searchParams.get("run") || legacyRunId || null;

  const selectRun = useCallback(
    (runId: string) => {
      navigate(`/refresh-jobs?run=${encodeURIComponent(runId)}`);
    },
    [navigate],
  );

  const clearSelection = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("run");
    // dataset/stage are Assistant context values derived from selected Run (#255 §2) — clearing
    // run selection also clears them to prevent previous run context leaking to next screen.
    next.delete("dataset");
    next.delete("stage");
    next.delete("source");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const items = listState.status === "loaded" ? listState.data : [];
  const runningAvailable = !isRealBuilderEnabled();
  const kpi = useMemo(() => computeBuildKpi(items, LIST_LIMIT, runningAvailable), [items, runningAvailable]);

  const visible = useMemo(
    () => items.filter((item) => matchesSearch(item, query) && matchesStatusFilter(item, statusFilter)),
    [items, query, statusFilter],
  );

  const selectedListItem = items.find((item) => item.id === selectedRunId) ?? null;
  const outOfListScope = Boolean(selectedRunId) && listState.status === "loaded" && !selectedListItem;
  const hiddenByFilter = Boolean(
    selectedListItem && !visible.some((item) => item.id === selectedListItem.id),
  );

  const stagesState = useAsync<RunStagesResponse>(
    (signal) => (selectedRunId ? listBuildStages(selectedRunId, signal) : Promise.reject(new Error("no run"))),
    [selectedRunId],
    t("builds.errors.loadStage"),
  );
  const qualityState = useAsync<BuildQualityResponse>(
    (signal) => (selectedRunId ? getBuildQuality(selectedRunId, signal) : Promise.reject(new Error("no run"))),
    [selectedRunId],
    t("builds.errors.loadQuality"),
  );
  const specState = useAsync<BuildSpecSnapshotResponse>(
    (signal) => (selectedRunId ? getBuildSpecSnapshot(selectedRunId, signal) : Promise.reject(new Error("no run"))),
    [selectedRunId],
    t("builds.errors.loadSpec"),
  );

  // Selected Run live (job registry) polling is enabled only when state is genuinely uncertain (#286
  // follow-up §1). In mock mode, builderApi.getBuildJob is a stub that always attempts real fetch,
  // causing repeated failures even for succeeded/failed historical runs, producing unnecessary
  // "live state update failure" warnings — in mock mode, we trust the list's deterministic mock
  // status as-is and skip live polling entirely. In real mode, runs already in the `GET /builds` list
  // are contractually completed (ok/failed) history only, so terminal status is already confirmed — we
  // don't enable queries until list loading finishes and confirms this (waiting for listState.status === "loaded"
  // avoids even one wasted call). If list loading finishes but run is out of scope (deep-link run),
  // it may actually be running/queued/cancelling, so we check with getBuildJob as before.
  const shouldPollLiveStatus =
    Boolean(selectedRunId) && isRealBuilderEnabled() && listState.status === "loaded" && !selectedListItem;
  const live = useSelectedRunPolling(shouldPollLiveStatus ? selectedRunId : null);

  // Event polling also follows the same "continue if non-terminal, stop if terminal" policy as
  // selected Run polling (#255 §3). ListItem's historical status is used for display (RunDetailPanel's
  // runStatus) but not for deciding whether to enable interval polling — we only start polling when
  // confirmed live job is actually non-terminal (same principle as useSelectedRunPolling).
  const eventsPollingEnabled = live.kind === "job" && !isTerminalBuilderStatus(live.job.status);
  const eventsState = useRunEvents(selectedRunId, eventsPollingEnabled);

  // Assistant Run context (#256) reuses the `?run=&dataset=&stage=` query convention read by existing
  // route resolver (features/assistant/context.ts) without a new context store (same as Quality/Dataset Detail).
  // Only reflect values actually confirmed in this screen — don't parse failure messages to guess stage;
  // only treat failedStage as safe context when exactly one source fails (#255 §2).
  useEffect(() => {
    if (!selectedRunId) return;
    const next = normalizeBuildContextSearch(searchParams, specState, stagesState);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [selectedRunId, specState, stagesState, searchParams, setSearchParams]);

  // Criteria for determining run doesn't exist: out of list scope AND stage query returns 404.
  // (stage endpoint can query any run_id directly regardless of list limit, making it a more reliable signal)
  const runNotFound =
    Boolean(selectedRunId) &&
    listState.status === "loaded" &&
    !selectedListItem &&
    stagesState.status === "error" &&
    stagesState.notFound;

  // When out of list scope so we lack listItem to judge existence, if the stage query we relied on
  // returns 403, distinguish "no permission to view" from "doesn't exist" (#255 P0).
  // Never conflate 404 and 403 — both result in "couldn't see info" but differ in reason.
  const runPermissionDenied =
    Boolean(selectedRunId) &&
    listState.status === "loaded" &&
    !selectedListItem &&
    stagesState.status === "error" &&
    stagesState.permissionDenied;

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      {/* App Shell topbar already has global "create new build" CTA (#255 §1) — don't duplicate action here. */}
      <PageHeader
        eyebrow="Runs"
        title={t("builds.page.title")}
        description={
          <span>
            <Trans i18nKey="builds.page.desc" components={{ b: <strong /> }} />{" "}
            <TermHelp term="build" /> <TermHelp term="run" />
          </span>
        }
      />

      <KpiRow kpi={kpi} />

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <RunListPanel
          listState={listState}
          visible={visible}
          query={query}
          onQueryChange={setQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          selectedRunId={selectedRunId}
          onSelect={selectRun}
          onRetry={loadList}
          hiddenByFilter={hiddenByFilter}
        />

        {selectedRunId ? (
          runNotFound ? (
            <Card variant="error" role="alert">
              <p className="font-semibold">{t("builds.run.notFoundTitle", { id: selectedRunId })}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("builds.run.notFoundDesc", { limit: LIST_LIMIT })}
              </p>
              <button
                type="button"
                className="mt-4 text-sm font-medium text-accent-subtle-foreground underline"
                onClick={clearSelection}
              >
                {t("builds.run.clearSelection")}
              </button>
            </Card>
          ) : runPermissionDenied ? (
            <Card variant="error" role="alert">
              <p className="font-semibold">{t("builds.run.forbiddenTitle", { id: selectedRunId })}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("builds.run.forbiddenDesc", { limit: LIST_LIMIT })}
              </p>
              <button
                type="button"
                className="mt-4 text-sm font-medium text-accent-subtle-foreground underline"
                onClick={clearSelection}
              >
                {t("builds.run.clearSelection")}
              </button>
            </Card>
          ) : (
            <RunDetailPanel
              runId={selectedRunId}
              listItem={selectedListItem}
              outOfListScope={outOfListScope}
              stagesState={stagesState}
              qualityState={qualityState}
              specState={specState}
              eventsState={eventsState}
              live={live}
            />
          )
        ) : (
          <Card className="flex min-h-64 items-center justify-center">
            <EmptyState title={t("builds.run.selectPrompt")} description={t("builds.run.selectPromptDesc")} />
          </Card>
        )}
      </div>
    </main>
  );
}
