/**
 * Hook managing build execution as an async job (#39).
 *
 * Provides the idle → running → succeeded/failed/cancelled state machine and
 * cancellation (AbortController). In real mode it uses the Builder async job
 * surface (POST /builds + GET /builds/{run_id} polling, builder #480/#482)
 * and exposes the polled job's wire status (queued/running/...) as
 * builderStatus (#245).
 */
import { i18n } from "@/shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  executeBuild,
  type BuildExecutionHandle,
  type BuildExecutionOptions,
  type BuilderJobStatus,
} from "@/features/runs/api";
import { ApiError, builderApi, extractErrorMessage } from "@/shared/lib/builderApi";
import type { BuildRun, BuildRunStatus, BuildSpec } from "@/shared/lib/types";

/**
 * Maps the terminal BuildRun.status (succeeded/failed/cancelled) returned by
 * executeBuild onto hook state. Never collapses cancelled into failed
 * (#S04).
 */
function toJobStatus(runStatus: BuildRunStatus): BuildJobStatus {
  if (runStatus === "succeeded") return "succeeded";
  if (runStatus === "cancelled") return "cancelled";
  return "failed";
}

export type BuildJobStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";

export interface BuildJob {
  /** Current job status. */
  status: BuildJobStatus;
  /** Latest wire status of the Builder job (queued/running/cancelling — during real-mode polling). */
  builderStatus?: BuilderJobStatus;
  /** Completed run result (on success/failure). */
  run?: BuildRun;
  /** Error message on failure. */
  error?: string;
  /**
   * Local-only marker that the user aborted the in-flight request client-side.
   *
   * The sync `POST /build` (file source, ADR 0014) has no server-side
   * cooperative-cancellation path, so a fetch abort does not stop the Builder
   * run — the build can still succeed or fail on the server. So this case
   * never finalizes status as canonical `cancelled`; the flag only surfaces
   * the client-side fact "the request was interrupted". Not a wire/canonical
   * BuildRun status.
   */
  interrupted: boolean;
  /** Starts a build run. */
  start: (spec: BuildSpec, options?: BuildExecutionOptions) => Promise<void>;
  /** Cancels the in-flight run. */
  cancel: () => void;
}

/**
 * Hook providing build-job state and control (start/cancel).
 *
 * @returns BuildJob state and control functions.
 */
export function useBuildJob(): BuildJob {
  const [status, setStatus] = useState<BuildJobStatus>("idle");
  const [builderStatus, setBuilderStatus] = useState<BuilderJobStatus>();
  const [run, setRun] = useState<BuildRun>();
  const [error, setError] = useState<string>();
  const [interrupted, setInterrupted] = useState(false);
  // Controller used only for unmount/restart (lifecycle) cancellation.
  // Semantically distinct from a user "cancel".
  const controllerRef = useRef<AbortController | null>(null);
  // Which Builder surface (sync/async) the in-flight run is on, and its
  // run_id. Lets user cancellation call POST /builds/{run_id}/cancel for
  // async jobs.
  const handleRef = useRef<BuildExecutionHandle | null>(null);
  // Intent of a Cancel pressed while the async submit is still in flight (no
  // handle exposed yet). Kept without aborting; applied exactly once when the
  // handle carrying the authoritative run_id arrives (F03).
  const pendingCancelRef = useRef(false);
  // Whether the async cooperative cancel was already fired once for this
  // run (coalesces repeated early Cancels).
  const cancelIssuedRef = useRef(false);

  // Requests the cooperative cancel for an async job exactly once. Keeps
  // polling — the Builder terminal status is the final answer, and a failed
  // cancel request does not become a local cancelled (#S03).
  const issueAsyncCancel = useCallback((runId: string) => {
    if (cancelIssuedRef.current) return;
    cancelIssuedRef.current = true;
    void builderApi.cancelBuildJob(runId).catch(() => {});
  }, []);

  const start = useCallback(async (spec: BuildSpec, options: BuildExecutionOptions = {}) => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    handleRef.current = null;
    pendingCancelRef.current = false;
    cancelIssuedRef.current = false;
    setStatus("running");
    setBuilderStatus(undefined);
    setError(undefined);
    setRun(undefined);
    setInterrupted(false);
    try {
      const result = await executeBuild(
        spec,
        controller.signal,
        (jobStatus) => {
          if (!controller.signal.aborted) setBuilderStatus(jobStatus);
        },
        (handle) => {
          handleRef.current = handle;
          // If Cancel was pressed before submit, fire the cooperative
          // cancel exactly once now that the authoritative run_id is settled
          // (F03).
          if (handle.mode === "async" && pendingCancelRef.current) {
            issueAsyncCancel(handle.runId);
          }
        },
        options,
      );
      if (controller.signal.aborted) return;
      setRun(result);
      // Preserves succeeded/failed/cancelled as-is — never overwrites
      // cancelled with failed (#S04).
      setStatus(toJobStatus(result.status));
      if (result.status === "failed") setError(result.error ?? i18n.t("runs.build.someSourcesFailed"));
    } catch (cause) {
      if (controller.signal.aborted) {
        // AbortController.abort() comes only from (a) user cancel of a sync
        // build, or (b) unmount lifecycle cleanup (async cancel does not
        // abort the controller). Either way a fetch abort cannot know the
        // Builder server-side outcome, so no terminal —
        // succeeded/failed/cancelled — is finalized; it only leaves running.
        // The "request interrupted" fact was already recorded by cancel()
        // calling setInterrupted(true).
        setStatus((current) => (current === "running" ? "idle" : current));
        return;
      }
      setStatus("failed");
      // /build 502 returns failure reasons via outcomes[].error without a
      // top-level error. Priority: top-level error (backcompat) →
      // outcomes[].error → ApiError message → generic message.
      const message =
        cause instanceof ApiError
          ? (extractErrorMessage(cause.details) ?? cause.message)
          : i18n.t("runs.build.runFailed");
      setError(message);
    } finally {
      // Once the run ends (success/failure/cancel), clear the now-invalid
      // controller reference.
      if (controllerRef.current === controller) controllerRef.current = null;
      handleRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    const handle = handleRef.current;
    if (handle?.mode === "async") {
      // Asks the real Builder for cooperative cancellation and keeps polling
      // — no "pretend cancelled" by cutting polling; the final state
      // (result.status) is decided by observing Builder reach the
      // cancelling → cancelled terminal (#S03). If already terminal or on a
      // network error, the polling outcome is authoritative and
      // issueAsyncCancel swallows it — a failed cancel request never becomes
      // a local `cancelled`. Repeated calls coalesce into one.
      issueAsyncCancel(handle.runId);
      return;
    }
    if (handle?.mode === "sync") {
      // sync `POST /build` (file source, ADR 0014): no server-side
      // cooperative-cancellation path. A fetch abort only interrupts the
      // client request and does not cancel the Builder run, so nothing —
      // success/failure/cancel — is finalized; only the fact "the request
      // was aborted client-side" is recorded (#S04, existing behavior
      // kept).
      controllerRef.current?.abort();
      setInterrupted(true);
      return;
    }
    // No handle yet = the async POST /builds submit is still in flight.
    // Aborting the fetch here cannot tell whether the server already
    // accepted the submit, risking an orphan build. So instead of aborting,
    // only the "cancel requested" intent is recorded — when the submit
    // succeeds and the handle with the authoritative run_id arrives, the
    // cooperative cancel fires exactly once (F03). Repeated presses
    // coalesce into one via the boolean.
    pendingCancelRef.current = true;
  }, [issueAsyncCancel]);

  // On unmount, abort the in-flight run to prevent setState after unmount
  // (#73).
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { status, builderStatus, run, error, interrupted, start, cancel };
}
