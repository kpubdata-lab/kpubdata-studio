/**
 * Hook to watch selected Run's live (async job) state (#255).
 *
 * GET /builds/{run_id} is backed by an in-memory active job registry (#245, builder #480/#482),
 * so runs already removed from registry return 404 — mark as "not_in_registry" and trust
 * historical state (list/stage summary) instead.
 *
 * 403 is distinct from 404 (#255 P0) — it's "no permission", not "not in registry", so treat as a separate kind and do not fallback silently.
 *
 * Transient network/5xx errors are not job states (#255): if a job was previously confirmed,
 * keep it and attach only a warning while polling continues. Only display an error kind
 * when no job was confirmed yet (first fetch failed). A successful subsequent poll clears the warning.
 * 404/403 are completely separate and unaffected by this.
 *
 * visibility-aware polling (#255 §3): on run selection/change always fetch immediately, then
 * use the shared useVisibilityAwarePolling for interval polling only when watching non-terminal jobs —
 * do not create a new scheduler. If tab is hidden, interval ticks do not start new requests;
 * on return to visible, refresh immediately.
 *
 * The runs client in force answers (#902), so the demo's jobs are polled the same way. Another
 * account signing in drops the job watched so far and aborts the request still out.
 */
import { i18n } from "@/shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTerminalBuilderStatus, POLL_INTERVAL_MS } from "@/features/runs/api";
import { classifyRunApiError } from "@/features/runs/model";
import { runsClient } from "@/features/runs/api/client";
import { useStorageOwnerKey } from "@/features/auth/storageOwner";
import { useVisibilityAwarePolling } from "./useVisibilityAwarePolling";
import type { BuildJob } from "@/shared/lib/builderApi";

export type SelectedRunLiveState =
  | { kind: "idle" }
  | { kind: "loading" }
  // If a warning is present, this job is the "last confirmed" state, not a fresh fetch (transient error).
  | { kind: "job"; job: BuildJob; warning?: string }
  | { kind: "not_in_registry" }
  | { kind: "permission_denied" }
  | { kind: "error"; message: string };

/**
 * @param runId - Run id to watch; null disables polling.
 * @param attempt - Change it to look the job up again, as a retry after the lookup itself failed.
 * @returns Latest async job state when present; a signal to use historical data when absent from the registry.
 */
export function useSelectedRunPolling(runId: string | null, attempt = 0): SelectedRunLiveState {
  const owner = useStorageOwnerKey();
  const [state, setState] = useState<SelectedRunLiveState>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  // Last confirmed job. Keep separately so transient errors don't overwrite it as "failed".
  const lastJobRef = useRef<BuildJob | null>(null);

  // One request per watched run at a time (#979): a tick that arrives while the previous answer is
  // still on its way joins it instead of aborting it, so an answer slower than the interval is
  // still read. Only a change of run, owner or attempt (the effect below) aborts — and responses
  // for an aborted signal are ignored, so an old response cannot overwrite the new selection.
  const inFlightRef = useRef<Promise<void> | null>(null);
  const fetchNow = useCallback((): Promise<void> => {
    if (!runId) return Promise.resolve();
    if (inFlightRef.current) return inFlightRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = (async () => {
      try {
        const job = await runsClient().getJob(runId, controller.signal);
        if (controller.signal.aborted) return;
        lastJobRef.current = job;
        // Successfully fetched; clear any previous transient error warning.
        setState({ kind: "job", job });
      } catch (cause) {
        if (controller.signal.aborted) return;
        const kind = classifyRunApiError(cause);
        if (kind === "not_found") {
          lastJobRef.current = null;
          setState({ kind: "not_in_registry" });
          return;
        }
        if (kind === "permission_denied") {
          lastJobRef.current = null;
          setState({ kind: "permission_denied" });
          return;
        }
        // Transient network/server error (#255 §10 polling lifecycle + follow-up).
        // If a job was already confirmed, keep it and attach only a warning — polling continues.
        // Only show error kind when no job was confirmed yet (first fetch failed).
        const message = cause instanceof Error ? cause.message : i18n.t("runs.errors.pollFailed");
        if (lastJobRef.current) {
          setState({ kind: "job", job: lastJobRef.current, warning: message });
        } else {
          setState({ kind: "error", message });
        }
      } finally {
        // A newer request has its own controller; only the request still current clears the slot.
        if (controllerRef.current === controller) inFlightRef.current = null;
      }
    })();
    inFlightRef.current = request;
    return request;
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      controllerRef.current?.abort();
      inFlightRef.current = null;
      lastJobRef.current = null;
      setState({ kind: "idle" });
      return;
    }
    // On run selection change, don't carry forward the previous run's "last confirmed job".
    lastJobRef.current = null;
    setState({ kind: "loading" });
    void fetchNow();
    return () => {
      controllerRef.current?.abort();
      inFlightRef.current = null;
    };
    // fetchNow is derived only from runId (useCallback deps: [runId]), so runId alone is sufficient.
  }, [runId, attempt, owner]);

  // Interval polling starts only after confirming the first fetch found a non-terminal job
  // (#245 original behavior) — do not poll while still "loading". First fetch is immediate via effect above,
  // so this gating does not delay initial fetch.
  const nonTerminal = state.kind === "job" && !isTerminalBuilderStatus(state.job.status);
  const pollingEnabled = Boolean(runId) && nonTerminal;

  useVisibilityAwarePolling(fetchNow, POLL_INTERVAL_MS, pollingEnabled);

  return state;
}
