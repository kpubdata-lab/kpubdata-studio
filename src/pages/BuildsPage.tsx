/**
 * Refresh history (`/refresh-jobs`) and one refresh's detail (`/refresh-jobs/:buildId`,
 * legacy `?run=<id>`) — #255, #535.
 *
 * The list is one filterable table (Run ID, Table, Status, Started, Duration, Snapshot);
 * search, the status filter and the table filter live in the URL (`?q=&status=&table=`),
 * so coming back from a detail keeps them. The table filter lists the tables the loaded
 * runs name (kpubdata-builder#844) and is left out when the Builder names none. A row opens `/refresh-jobs/:id`, where the run-centred diagnostics
 * live: stage progress, failure evidence, spec digest and the event log (RunDetailPanel).
 * Studio never recalculates or guesses values returned by Builder (#246 principle).
 *
 * This file handles **screen assembly only** (#379). Components live under `features/runs`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";

import { getBuildQuality, listBuildStages } from "@/features/datasets/api";
import { LoadMoreRuns } from "@/features/datasets/components/LoadMoreRuns";
import {
  BUILD_HISTORY_LIMIT,
  mayHaveMoreRuns,
  nextRunHistoryLimit,
  type LoadMoreStatus,
} from "@/features/datasets/runHistory";
import {
  matchesSearch,
  matchesStatusFilter,
  matchesTableFilter,
  runTables,
  type RunStatusFilter,
} from "@/features/runs/model";
import { isTerminalBuilderStatus, listBuilds } from "@/features/runs/api";
import { getBuildSpecSnapshot } from "@/features/runs/api/runDetail";
import { useAsync, type AsyncState } from "@/features/runs/asyncState";
import { buildStatusFilters, normalizeBuildContextSearch } from "@/features/runs/buildContext";
import { RefreshHistoryTable } from "@/features/runs/components/RefreshHistoryTable";
import { RunDetailPanel } from "@/features/runs/components/RunDetailPanel";
import { useSelectedRunPolling } from "@/features/runs/useSelectedRunPolling";
import { useRunEvents } from "@/features/runs/useRunEvents";
import type {
  BuildQualityResponse,
  BuildSpecSnapshotResponse,
  RunStagesResponse,
} from "@/shared/lib/builderApi";
import { isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { BuildListItem } from "@/shared/lib/types";
import { Card, ErrorState, LinkButton, PageHeader, Select, SkeletonTable, TermHelp, TextInput } from "@/shared/ui";


const STATUS_FILTERS: RunStatusFilter[] = ["all", "succeeded", "failed", "running", "queued", "cancelled"];

/**
 * Whether the browser shows the refresh list rather than run `runId`'s detail. Only a
 * browser path under `/refresh-jobs` counts, so an in-memory router is never judged by it.
 */
export function leftDetail(browserPath: string, runId: string): boolean {
  if (!browserPath.includes("/refresh-jobs")) return false;
  return !browserPath.endsWith(`/refresh-jobs/${encodeURIComponent(runId)}`);
}

export function BuildsPage() {
  const { t } = useTranslation();
  const { buildId: pathRunId } = useParams<{ buildId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [listState, setListState] = useState<AsyncState<BuildListItem[]>>({ status: "loading" });
  // `/builds` request scope. Builder has no cursor and no total count, so "show more" asks
  // again with a larger limit and the list says when it may be cut (#653).
  const [listLimit, setListLimit] = useState(BUILD_HISTORY_LIMIT);
  const [more, setMore] = useState<{ status: LoadMoreStatus; error?: string }>({ status: "idle" });
  const moreRequest = useRef(0);

  const loadList = useCallback(() => {
    const controller = new AbortController();
    moreRequest.current += 1;
    setListState({ status: "loading" });
    setListLimit(BUILD_HISTORY_LIMIT);
    setMore({ status: "idle" });
    listBuilds(BUILD_HISTORY_LIMIT)
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

  // The loaded list stays on screen while the larger one loads, and when it fails.
  function loadMore() {
    const limit = nextRunHistoryLimit(listLimit);
    const request = ++moreRequest.current;
    setMore({ status: "loading" });
    listBuilds(limit)
      .then((items) => {
        if (request !== moreRequest.current) return;
        setListState({ status: "loaded", data: items });
        setListLimit(limit);
        setMore({ status: "idle" });
      })
      .catch((cause: unknown) => {
        if (request !== moreRequest.current) return;
        setMore({ status: "error", error: cause instanceof Error ? cause.message : undefined });
      });
  }

  // The detail is `/refresh-jobs/:id`; an older `?run=` link opens the same detail and
  // wins when both are present.
  const selectedRunId = searchParams.get("run") || pathRunId || null;

  const clearSelection = useCallback(() => navigate("/refresh-jobs"), [navigate]);

  const query = searchParams.get("q") ?? "";
  const requestedStatus = searchParams.get("status") as RunStatusFilter | null;
  const statusFilter: RunStatusFilter = requestedStatus && STATUS_FILTERS.includes(requestedStatus) ? requestedStatus : "all";

  const tableFilter = searchParams.get("table") ?? "";

  function setListParam(key: "q" | "status" | "table", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const items = listState.status === "loaded" ? listState.data : [];
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          matchesSearch(item, query) && matchesStatusFilter(item, statusFilter) && matchesTableFilter(item, tableFilter),
      ),
    [items, query, statusFilter, tableFilter],
  );
  // Only runs from a Builder that names their table (kpubdata-builder#844) can be filtered by it.
  const tables = useMemo(() => runTables(items), [items]);

  const selectedListItem = items.find((item) => item.id === selectedRunId) ?? null;
  const outOfListScope = Boolean(selectedRunId) && listState.status === "loaded" && !selectedListItem;

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
  const [liveAttempt, setLiveAttempt] = useState(0);
  const live = useSelectedRunPolling(shouldPollLiveStatus ? selectedRunId : null, liveAttempt);

  // What Builder keeps of a run is read again whenever the job's status changes (#875).
  // Read once per run id, a run opened while it waited kept the 404s of that moment —
  // stages, quality, spec — after it had started and ended, until the page was reloaded.
  const liveStatus = live.kind === "job" ? live.job.status : null;
  const stagesState = useAsync<RunStagesResponse>(
    (signal) => (selectedRunId ? listBuildStages(selectedRunId, signal) : Promise.reject(new Error("no run"))),
    [selectedRunId, liveStatus],
    t("builds.errors.loadStage"),
  );
  const qualityState = useAsync<BuildQualityResponse>(
    (signal) => (selectedRunId ? getBuildQuality(selectedRunId, signal) : Promise.reject(new Error("no run"))),
    [selectedRunId, liveStatus],
    t("builds.errors.loadQuality"),
  );
  const specState = useAsync<BuildSpecSnapshotResponse>(
    (signal) => (selectedRunId ? getBuildSpecSnapshot(selectedRunId, signal) : Promise.reject(new Error("no run"))),
    [selectedRunId, liveStatus],
    t("builds.errors.loadSpec"),
  );


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
    // The router renders navigations in a transition, so a detail's loads can finish after
    // Back has already moved the browser to the list. Its search-only replace would then land
    // on the list URL and drop its filters; skip it once the browser has left this detail.
    if (pathRunId && leftDetail(window.location.pathname, pathRunId)) return;
    const next = normalizeBuildContextSearch(searchParams, specState, stagesState);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [selectedRunId, pathRunId, specState, stagesState, searchParams, setSearchParams]);

  // Criteria for determining run doesn't exist: out of list scope AND stage query returns 404
  // (stage endpoint can query any run_id directly regardless of list limit, making it a more reliable signal)
  // AND Builder's job lookup says it does not know the run either. A run that has not started has no
  // stages: a queued one, or one that ended before it started because its keys were gone (#846). The
  // registry has it, and its detail — the lost-keys card, the cancel button — is what to show.
  // "Not found" is decided positively: while the lookup is idle or loading, or when it failed, we do
  // not know — only an answer of "unknown run" counts. Mock mode has no live lookup to wait for.
  const liveSaysUnknown =
    !isRealBuilderEnabled() || live.kind === "not_in_registry" || live.kind === "permission_denied";
  const listedNowhere =
    Boolean(selectedRunId) &&
    listState.status === "loaded" &&
    !selectedListItem &&
    stagesState.status === "error" &&
    stagesState.notFound;
  const runNotFound = listedNowhere && liveSaysUnknown;
  // The lookup itself failed (network, 5xx): Studio cannot tell a missing run from a failed check.
  const runCheckFailed = listedNowhere && isRealBuilderEnabled() && live.kind === "error";

  // When out of list scope so we lack listItem to judge existence, if the stage query we relied on
  // returns 403, distinguish "no permission to view" from "doesn't exist" (#255 P0).
  // Never conflate 404 and 403 — both result in "couldn't see info" but differ in reason.
  const runPermissionDenied =
    Boolean(selectedRunId) &&
    listState.status === "loaded" &&
    !selectedListItem &&
    stagesState.status === "error" &&
    stagesState.permissionDenied;

  const main = "flex flex-1 flex-col gap-4 px-5 py-8 sm:px-8 lg:px-10 lg:py-10";

  if (selectedRunId) {
    return (
      <div className={main}>
        <PageHeader
          title={t("builds.detail.title")}
          meta={<span className="font-mono">{selectedRunId}</span>}
          actions={
            <LinkButton size="sm" to="/refresh-jobs" variant="secondary">
              {t("builds.detail.back")}
            </LinkButton>
          }
        />
        {runNotFound ? (
          <Card variant="error" role="alert">
            <p className="font-semibold">{t("builds.run.notFoundTitle", { id: selectedRunId })}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t("builds.run.notFoundDesc", { limit: listLimit })}</p>
            <button className="mt-4 text-sm font-medium text-brand-text underline" onClick={clearSelection} type="button">
              {t("builds.run.clearSelection")}
            </button>
          </Card>
        ) : runCheckFailed ? (
          <Card variant="error" role="alert">
            <p className="font-semibold">{t("builds.run.checkFailedTitle", { id: selectedRunId })}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t("builds.run.checkFailedDesc")}</p>
            <button
              className="mt-4 text-sm font-medium text-brand-text underline"
              onClick={() => setLiveAttempt((n) => n + 1)}
              type="button"
            >
              {t("builds.run.checkRetry")}
            </button>
          </Card>
        ) : runPermissionDenied ? (
          <Card variant="error" role="alert">
            <p className="font-semibold">{t("builds.run.forbiddenTitle", { id: selectedRunId })}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t("builds.run.forbiddenDesc", { limit: listLimit })}</p>
            <button className="mt-4 text-sm font-medium text-brand-text underline" onClick={clearSelection} type="button">
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
        )}
      </div>
    );
  }

  return (
    <div className={main}>
      {/* App Shell topbar already has the global create CTA (#255 §1) — no action duplicated here. */}
      <PageHeader
        title={t("builds.page.title")}
        description={
          <span>
            <Trans i18nKey="builds.page.desc" components={{ b: <strong /> }} />{" "}
            <TermHelp term="build" /> <TermHelp term="run" />
          </span>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          aria-label={t("builds.search.aria")}
          className="flex-1"
          onChange={(event) => setListParam("q", event.target.value)}
          placeholder={t("builds.search.placeholder")}
          value={query}
        />
        <Select
          aria-label={t("builds.search.filterAria")}
          className="sm:w-40"
          onChange={(event) => setListParam("status", event.target.value)}
          value={statusFilter}
        >
          {buildStatusFilters(t).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {tables.length > 0 ? (
          <Select
            aria-label={t("builds.search.tableFilterAria")}
            className="sm:w-56"
            onChange={(event) => setListParam("table", event.target.value)}
            value={tableFilter}
          >
            <option value="">{t("builds.search.allTables")}</option>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.label}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {listState.status === "loading" ? (
        <SkeletonTable rows={6} />
      ) : listState.status === "error" ? (
        <ErrorState title={t("builds.errors.loadList")} message={listState.error} onRetry={loadList} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("builds.table.empty")}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("builds.search.emptyTitle")} — {t("builds.search.emptyDesc")}</p>
      ) : (
        <RefreshHistoryTable items={visible} />
      )}

      {listState.status === "loaded" ? (
        <>
          <LoadMoreRuns
            count={items.length}
            limit={listLimit}
            status={more.status}
            error={more.error}
            canLoadMore={mayHaveMoreRuns(items.length, listLimit)}
            onLoadMore={loadMore}
          />
          {isRealBuilderEnabled() ? <p className="text-xs text-muted-foreground">{t("builds.kpi.completedOnlyHint")}</p> : null}
        </>
      ) : null}
    </div>
  );
}
