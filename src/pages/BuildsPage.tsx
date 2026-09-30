/**
 * Refresh history (`/refresh-jobs`) and one refresh's detail (`/refresh-jobs/:buildId`,
 * legacy `?run=<id>`) — #255, #535.
 *
 * The list is one filterable table (Run ID, Table, Status, Started, Duration, Snapshot);
 * search and the status filter live in the URL (`?q=&status=`), so coming back from a
 * detail keeps them. A row opens `/refresh-jobs/:id`, where the run-centred diagnostics
 * live: stage progress, failure evidence, spec digest and the event log (RunDetailPanel).
 * Studio never recalculates or guesses values returned by Builder (#246 principle).
 *
 * This file handles **screen assembly only** (#379). Components live under `features/runs`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";

import { getBuildQuality, listBuildStages } from "@/features/datasets/api";
import { matchesSearch, matchesStatusFilter, type RunStatusFilter } from "@/features/runs/model";
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

/** `/builds` request scope. Builder has no total count, so the list says when it may be cut. */
const LIST_LIMIT = 100;

const STATUS_FILTERS: RunStatusFilter[] = ["all", "succeeded", "failed", "running", "queued", "cancelled"];

export function BuildsPage() {
  const { t } = useTranslation();
  const { buildId: pathRunId } = useParams<{ buildId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [listState, setListState] = useState<AsyncState<BuildListItem[]>>({ status: "loading" });

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

  // The detail is `/refresh-jobs/:id`; an older `?run=` link opens the same detail and
  // wins when both are present.
  const selectedRunId = searchParams.get("run") || pathRunId || null;

  const clearSelection = useCallback(() => navigate("/refresh-jobs"), [navigate]);

  const query = searchParams.get("q") ?? "";
  const requestedStatus = searchParams.get("status") as RunStatusFilter | null;
  const statusFilter: RunStatusFilter = requestedStatus && STATUS_FILTERS.includes(requestedStatus) ? requestedStatus : "all";

  function setListParam(key: "q" | "status", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const items = listState.status === "loaded" ? listState.data : [];
  const visible = useMemo(
    () => items.filter((item) => matchesSearch(item, query) && matchesStatusFilter(item, statusFilter)),
    [items, query, statusFilter],
  );

  const selectedListItem = items.find((item) => item.id === selectedRunId) ?? null;
  const outOfListScope = Boolean(selectedRunId) && listState.status === "loaded" && !selectedListItem;

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

  const main = "flex flex-1 flex-col gap-4 px-5 py-8 sm:px-8 lg:px-10 lg:py-10";

  if (selectedRunId) {
    return (
      <main className={main}>
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
            <p className="mt-2 text-sm text-muted-foreground">{t("builds.run.notFoundDesc", { limit: LIST_LIMIT })}</p>
            <button className="mt-4 text-sm font-medium text-accent-subtle-foreground underline" onClick={clearSelection} type="button">
              {t("builds.run.clearSelection")}
            </button>
          </Card>
        ) : runPermissionDenied ? (
          <Card variant="error" role="alert">
            <p className="font-semibold">{t("builds.run.forbiddenTitle", { id: selectedRunId })}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t("builds.run.forbiddenDesc", { limit: LIST_LIMIT })}</p>
            <button className="mt-4 text-sm font-medium text-accent-subtle-foreground underline" onClick={clearSelection} type="button">
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
      </main>
    );
  }

  return (
    <main className={main}>
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
        <p className="text-xs text-muted-foreground">
          {t("builds.table.scope", { count: items.length, limit: LIST_LIMIT })}
          {isRealBuilderEnabled() ? ` ${t("builds.kpi.completedOnlyHint")}` : null}
        </p>
      ) : null}
    </main>
  );
}
