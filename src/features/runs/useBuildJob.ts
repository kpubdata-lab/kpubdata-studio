/**
 * Hook managing build execution as an async job (#39).
 *
 * Provides the idle → running → succeeded/failed/cancelled state machine and
 * cancellation (AbortController). In real mode it uses the Builder async job
 * surface (POST /builds + GET /builds/{run_id} polling, builder #480/#482)
 * and exposes the polled job's wire status (queued/running/...) as
 * builderStatus (#245). The runs client in force answers (#902): the demo's jobs are submitted,
 * polled and cancelled the same way.
 *
 * Another account signing in aborts the polling (the job is not cancelled — it is the other
 * account's) and returns the hook to idle, so one account's build is never shown under another's.
 *
 * A submission outlives the screen that sent it (#986). Leaving the screen stops the polling,
 * never the `POST /builds`: until a mounted screen has shown the run id Builder answered with,
 * the submission is kept here, by screen and account, and the screen opened again follows that
 * job instead of losing it or sending it twice.
 */
import { i18n } from "@/shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  executeBuild,
  followBuild,
  type BuildExecutionHandle,
  type BuildExecutionOptions,
  type BuilderJobStatus,
} from "@/features/runs/api";
import { runsClient } from "@/features/runs/api/client";
import { useStorageOwnerKey } from "@/features/auth/storageOwner";
import { ApiError, extractErrorMessage } from "@/shared/lib/builderApi";
import { buildRefusal, buildRefusalMessage } from "./buildRefusal";
import { missingProviderKeys, type MissingProviderKeys } from "@/shared/lib/missingProviderKey";
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

/**
 * A build submitted from a screen, kept until a mounted screen has shown its outcome (#986).
 *
 * `accepted` settles with the run id Builder accepted, or with why it was not accepted —
 * whether or not the screen that sent it is still there.
 */
interface Submission {
  spec: BuildSpec;
  accepted: Promise<string>;
  /** Cancel was pressed before the run id was known; sent once that id is. */
  cancelRequested: boolean;
  cancelIssued: boolean;
}

/** Submissions not yet shown, by screen and account owner key. */
const submissions = new Map<string, Submission>();

function submissionKey(scope: string, owner: string): string {
  return `${scope}\u0000${owner}`;
}

/** Forget every kept submission. For tests, which share one module between cases. */
export function forgetBuildSubmissionsForTests(): void {
  submissions.clear();
}

/** Cancel the job once (#S03): a failed request does not become a local `cancelled`. */
function issueCancel(submission: Submission, runId: string): void {
  if (submission.cancelIssued) return;
  submission.cancelIssued = true;
  void runsClient().cancel(runId).catch(() => {});
}

/** `promise`, or an AbortError as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export type BuildJobStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";

export interface BuildJob {
  /** Current job status. */
  status: BuildJobStatus;
  /** Latest wire status of the Builder job (queued/running/cancelling — during real-mode polling). */
  builderStatus?: BuilderJobStatus;
  /** Completed run result (on success/failure). */
  run?: BuildRun;
  /**
   * The run id Builder gave the job when it accepted it (#842) — known long before the
   * run ends, and what a caller needs to show the run instead of waiting here for it.
   */
  submittedRunId?: string;
  /** Error message on failure. */
  error?: string;
  /**
   * The build was refused because the request carried no key for these providers (#787).
   * Nothing was submitted: once the key is given, the same spec can be started again.
   */
  missingKeys?: MissingProviderKeys;
  /** Starts a build run. */
  start: (spec: BuildSpec, options?: BuildExecutionOptions) => Promise<void>;
  /** Cancels the in-flight run. */
  cancel: () => void;
}

/**
 * Hook providing build-job state and control (start/cancel).
 *
 * @param scope - The screen the build belongs to. A submission left in flight is found again
 *   by the same screen, never by another one.
 * @returns BuildJob state and control functions.
 */
export function useBuildJob(scope = "build"): BuildJob {
  const [status, setStatus] = useState<BuildJobStatus>("idle");
  const [builderStatus, setBuilderStatus] = useState<BuilderJobStatus>();
  const [run, setRun] = useState<BuildRun>();
  const [submittedRunId, setSubmittedRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const [missingKeys, setMissingKeys] = useState<MissingProviderKeys>();
  // Controller used only for unmount/restart (lifecycle) cancellation.
  // Semantically distinct from a user "cancel".
  const controllerRef = useRef<AbortController | null>(null);
  // Which Builder surface (sync/async) the in-flight run is on, and its
  // run_id. Lets user cancellation call POST /builds/{run_id}/cancel for
  // async jobs.
  const handleRef = useRef<BuildExecutionHandle | null>(null);
  // The submission this hook drives. A Cancel pressed while its POST /builds is still in
  // flight (no handle yet) is kept on it without aborting, and sent exactly once when the
  // authoritative run_id arrives (F03) — even if the screen has been left by then (#986).
  const submissionRef = useRef<Submission | null>(null);
  const owner = useStorageOwnerKey();
  const ownerRef = useRef(owner);

  /** Show `submission` from here on: lifecycle state reset, the job about to be followed. */
  const begin = useCallback((submission: Submission): AbortController => {
    const controller = new AbortController();
    controllerRef.current = controller;
    handleRef.current = null;
    submissionRef.current = submission;
    setStatus("running");
    setBuilderStatus(undefined);
    setError(undefined);
    setMissingKeys(undefined);
    setRun(undefined);
    setSubmittedRunId(undefined);
    return controller;
  }, []);

  /** The run id is known: let Cancel reach it, and show it while mounted. */
  const accept = useCallback((controller: AbortController, submission: Submission, runId: string) => {
    if (controller.signal.aborted) return;
    handleRef.current = { runId, mode: "async" };
    setSubmittedRunId(runId);
    if (submission.cancelRequested) issueCancel(submission, runId);
  }, []);

  /** Show how the build ended, or why it could not be followed; only while still mounted. */
  const settle = useCallback(
    async (controller: AbortController, key: string, submission: Submission, work: () => Promise<BuildRun>) => {
      try {
        const result = await work();
        if (controller.signal.aborted) return;
        if (submissions.get(key) === submission) submissions.delete(key);
        setRun(result);
        // Preserves succeeded/failed/cancelled as-is — never overwrites
        // cancelled with failed (#S04).
        setStatus(toJobStatus(result.status));
        if (result.status === "failed") setError(result.error ?? i18n.t("runs.build.someSourcesFailed"));
      } catch (cause) {
        if (controller.signal.aborted) {
          // AbortController.abort() comes only from unmount cleanup or another account
          // signing in: cancel goes to Builder (POST /builds/{run_id}/cancel) and never
          // aborts the controller. Polling cannot know the server-side outcome, so no
          // terminal — succeeded/failed/cancelled — is finalized; it only leaves running,
          // unless the hook has already moved on to another run.
          if (controllerRef.current === null) setStatus((current) => (current === "running" ? "idle" : current));
          return;
        }
        // Said here, so not kept to be said again.
        if (submissions.get(key) === submission) submissions.delete(key);
        setStatus("failed");
        // /build 502 returns failure reasons via outcomes[].error without a
        // top-level error. Priority: top-level error (backcompat) →
        // outcomes[].error → ApiError message → generic message.
        // A build turned away for want of room is said in the user's language (#859).
        const refusal = buildRefusal(cause);
        const message = refusal
          ? buildRefusalMessage(refusal)
          : cause instanceof ApiError
            ? (extractErrorMessage(cause.details) ?? cause.message)
            : i18n.t("runs.build.runFailed");
        setError(message);
        setMissingKeys(missingProviderKeys(cause) ?? undefined);
      } finally {
        // Once the run ends (success/failure/cancel), clear the now-invalid
        // controller reference.
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          handleRef.current = null;
          submissionRef.current = null;
        }
      }
    },
    [],
  );

  const start = useCallback(async (spec: BuildSpec, options: BuildExecutionOptions = {}) => {
    if (controllerRef.current) return;
    let acceptRunId!: (runId: string) => void;
    let refuse!: (cause: unknown) => void;
    const accepted = new Promise<string>((resolve, reject) => {
      acceptRunId = resolve;
      refuse = reject;
    });
    // Read only by a screen opened again; nobody may be there to read a refusal.
    accepted.catch(() => {});
    const submission: Submission = { spec, accepted, cancelRequested: false, cancelIssued: false };
    const key = submissionKey(scope, ownerRef.current);
    submissions.set(key, submission);
    const controller = begin(submission);
    await settle(controller, key, submission, async () => {
      try {
        return await executeBuild(
          spec,
          controller.signal,
          (jobStatus) => {
            if (!controller.signal.aborted) setBuilderStatus(jobStatus);
          },
          (handle) => {
            // Recorded whether or not this screen is still there (#986).
            acceptRunId(handle.runId);
            if (submission.cancelRequested) issueCancel(submission, handle.runId);
            accept(controller, submission, handle.runId);
          },
          options,
        );
      } catch (cause) {
        // No effect once accepted: a promise settles once.
        refuse(cause);
        throw cause;
      } finally {
        refuse(new Error("the build ended without a run id"));
      }
    });
  }, [scope, begin, accept, settle]);

  // On unmount, abort the in-flight run to prevent setState after unmount
  // (#73).
  // The reference is dropped too: under StrictMode the same hook mounts again at once, and
  // must find no run of its own in progress so it can pick the kept submission up (#986).
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  // Another account signed in: stop watching the previous one's run and forget it (#902).
  // A submission still in flight stays kept under the account that sent it.
  useEffect(() => {
    if (ownerRef.current === owner) return;
    ownerRef.current = owner;
    controllerRef.current?.abort();
    controllerRef.current = null;
    handleRef.current = null;
    submissionRef.current = null;
    setStatus("idle");
    setBuilderStatus(undefined);
    setRun(undefined);
    setSubmittedRunId(undefined);
    setError(undefined);
    setMissingKeys(undefined);
  }, [owner]);

  // A submission this screen left in flight, or one accepted after it was left: follow it,
  // never send it again (#986). Looked for on mount and when the account changes.
  useEffect(() => {
    const key = submissionKey(scope, owner);
    const submission = submissions.get(key);
    if (!submission || controllerRef.current) return;
    const controller = begin(submission);
    void settle(controller, key, submission, async () => {
      const runId = await untilAborted(submission.accepted, controller.signal);
      if (submission.cancelRequested) issueCancel(submission, runId);
      accept(controller, submission, runId);
      return followBuild(runId, submission.spec, controller.signal, (jobStatus) => {
        if (!controller.signal.aborted) setBuilderStatus(jobStatus);
      });
    });
  }, [scope, owner, begin, accept, settle]);

  // The run id has been shown on a mounted screen: from here its own page follows it, and
  // a screen opened later starts from nothing.
  useEffect(() => {
    if (!submittedRunId) return;
    const key = submissionKey(scope, owner);
    if (submissions.get(key) === submissionRef.current) submissions.delete(key);
  }, [submittedRunId, scope, owner]);

  const cancel = useCallback(() => {
    const handle = handleRef.current;
    if (handle?.mode === "async") {
      // Asks the real Builder for cooperative cancellation and keeps polling
      // — no "pretend cancelled" by cutting polling; the final state
      // (result.status) is decided by observing Builder reach the
      // cancelling → cancelled terminal (#S03). If already terminal or on a
      // network error, the polling outcome is authoritative and
      // issueCancel swallows it — a failed cancel request never becomes
      // a local `cancelled`. Repeated calls coalesce into one.
      const submission = submissionRef.current;
      if (submission) issueCancel(submission, handle.runId);
      return;
    }
    // No handle yet = the async POST /builds submit is still in flight.
    // Aborting the fetch here cannot tell whether the server already
    // accepted the submit, risking an orphan build. So instead of aborting,
    // only the "cancel requested" intent is recorded — when the submit
    // succeeds and the handle with the authoritative run_id arrives, the
    // cooperative cancel fires exactly once (F03). Repeated presses
    // coalesce into one via the boolean.
    if (submissionRef.current) submissionRef.current.cancelRequested = true;
  }, []);

  return { status, builderStatus, run, submittedRunId, error, missingKeys, start, cancel };
}
