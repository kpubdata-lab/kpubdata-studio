/**
 * Run history beyond its first page (#653).
 *
 * `GET /datasets/{dataset_id}/runs` and `GET /builds` return the newest runs up to `limit`
 * and nothing else — no cursor, no total. So "show more" asks again with a larger limit
 * and replaces the list with the answer; a list shorter than the limit it was asked with
 * is the whole history. Builder refuses a limit above {@link LIST_LIMIT_MAX} (400,
 * kpubdata-builder#1327), so the last step asks for exactly that many and then stops; a
 * full page at that size may still hide older runs, and the screen says so.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { listDatasetRuns } from "@/features/datasets/api";
import { LIST_LIMIT_MAX, type DatasetRunSummary } from "@/shared/lib/builderApi";

/**
 * How many of a table's runs are asked for first — Builder's own default. Table Detail's
 * run view and its Snapshots tab share it, so the same table never shows two different
 * histories.
 */
export const RUN_HISTORY_LIMIT = 50;

/** How many refreshes the global history asks for first. */
export const BUILD_HISTORY_LIMIT = 100;

/** The next limit to ask with: three times the last, capped at Builder's maximum (50 → 150 → 450 → 1000). */
export function nextRunHistoryLimit(limit: number): number {
  return Math.min(limit * 3, LIST_LIMIT_MAX);
}

/** Whether `limit` is already the largest Builder accepts, so no larger page can be asked for. */
export function atRunHistoryMax(limit: number): boolean {
  return limit >= LIST_LIMIT_MAX;
}

/** A full page may hide older runs; a shorter one is everything Builder has. */
export function mayHaveMoreRuns(received: number, limit: number): boolean {
  return received >= limit;
}

export type LoadMoreStatus = "idle" | "loading" | "error";

export interface RunHistoryPaging {
  /** The runs to show: the last larger page once one has loaded, otherwise the first. */
  runs: DatasetRunSummary[] | undefined;
  /** The limit `runs` was asked with. */
  limit: number;
  status: LoadMoreStatus;
  error?: string;
  /** A full page came back, so older runs may exist (even when no larger page can be asked for). */
  canLoadMore: boolean;
  loadMore: () => void;
}

/**
 * "Show more" for one table's run history. `firstPage` is what the screen loaded with
 * {@link RUN_HISTORY_LIMIT}; a later page replaces it until the table changes.
 */
export function useRunHistoryPaging(datasetId: string, firstPage: DatasetRunSummary[] | undefined): RunHistoryPaging {
  const [more, setMore] = useState<{ key: string; limit: number; runs?: DatasetRunSummary[]; status: LoadMoreStatus; error?: string }>({
    key: datasetId,
    limit: RUN_HISTORY_LIMIT,
    status: "idle",
  });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), [datasetId]);

  const current = more.key === datasetId ? more : { key: datasetId, limit: RUN_HISTORY_LIMIT, status: "idle" as const, runs: undefined, error: undefined };
  const runs = current.runs ?? firstPage;

  const loadMore = useCallback(() => {
    if (atRunHistoryMax(current.limit)) return;
    const limit = nextRunHistoryLimit(current.limit);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setMore({ ...current, key: datasetId, status: "loading", error: undefined });
    listDatasetRuns(datasetId, limit, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setMore({ key: datasetId, limit, runs: response.runs, status: "idle" });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setMore({ ...current, key: datasetId, status: "error", error: cause instanceof Error ? cause.message : undefined });
      });
  }, [datasetId, current]);

  return {
    runs,
    limit: current.limit,
    status: current.status,
    error: current.error,
    canLoadMore: runs !== undefined && mayHaveMoreRuns(runs.length, current.limit),
    loadMore,
  };
}
