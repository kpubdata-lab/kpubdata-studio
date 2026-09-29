/**
 * Is the run a URL asks for one the caller can open? (#418)
 *
 * The runs list holds only the newest page, so "not in the list" is not "invalid": an
 * older run is still a valid permalink. When the requested run is not in the page, ask
 * Builder for it directly, and let Builder decide membership and ownership.
 *
 *   none       no run was requested; the page shows the latest
 *   loading    the list has not loaded, or the direct lookup is in flight
 *   available  in the page, or found directly — `run` is its summary
 *   not_found  Builder: no run with this id belongs to the dataset (404)
 *   forbidden  Builder: it does, but not to the caller (403)
 *   error      the check itself failed (network, 5xx); nothing is known about the run
 */
import { useEffect, useState } from "react";
import { ApiError, type DatasetRunSummary } from "@/shared/lib/builderApi";
import { getDatasetRun } from "./api";

export type RequestedRunState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "available"; run: DatasetRunSummary; inPage: boolean }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "error" };

type Lookup = { key: string; state: RequestedRunState };

export function useRequestedRun(
  datasetId: string,
  requestedRunId: string | null,
  pageRuns: readonly DatasetRunSummary[] | undefined,
): RequestedRunState {
  const inPage = requestedRunId ? pageRuns?.find((run) => run.run_id === requestedRunId) : undefined;
  const needsLookup = Boolean(requestedRunId && pageRuns && !inPage);
  const key = `${datasetId}\u0000${requestedRunId ?? ""}`;
  const [lookup, setLookup] = useState<Lookup | null>(null);

  useEffect(() => {
    if (!needsLookup || !requestedRunId) return;
    const controller = new AbortController();
    getDatasetRun(datasetId, requestedRunId, controller.signal)
      .then((response) => setLookup({ key, state: { status: "available", run: response.run, inPage: false } }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const status = cause instanceof ApiError ? cause.status : 0;
        const state: RequestedRunState =
          status === 404 ? { status: "not_found" } : status === 403 ? { status: "forbidden" } : { status: "error" };
        setLookup({ key, state });
      });
    return () => controller.abort();
  }, [datasetId, requestedRunId, needsLookup, key]);

  if (!requestedRunId) return { status: "none" };
  if (!pageRuns) return { status: "loading" };
  if (inPage) return { status: "available", run: inPage, inPage: true };
  // A lookup answers only the request it was made for; a stale one reads as loading.
  return lookup?.key === key ? lookup.state : { status: "loading" };
}
