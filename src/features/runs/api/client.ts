/**
 * The runs client: one interface, and the two things that implement it (#902).
 *
 * As in `features/datasets/api/client.ts`: the run screens ask `runsClient()` and do not
 * know whether a Builder or the demo answers. The job calls — submit, read, cancel — keep
 * Builder's shapes, so the one polling and cancelling state machine (`executeBuild`,
 * `useBuildJob`, `useSelectedRunPolling`) runs over both, where the demo used to return a
 * finished run without passing through any of it. `client.contract.test.ts` holds the two
 * to the same expectations. What is the demo's own, and written down:
 *
 * - a build ends at once: the job a submission answers with has already succeeded. A test
 *   asks for one that waits (`createDemoRunsClient(…, { pollsUntilDone })`) to take the
 *   polling and cancelling paths;
 * - its job registry holds only what was submitted in this page load. The runs of its
 *   history are answered 404, as a Builder answers for a run its registry no longer has;
 * - its history lists runs that are still queued or running, which a Builder's
 *   `GET /builds` never does — the demo shows those states without a run to wait for;
 * - it keeps no spec snapshot and no event timeline: both reject with
 *   `MockUnsupportedError`, which the screens show as "not in the demo", not as a failure.
 */
import { i18n } from "@/shared/i18n";
import { ApiError, builderApi, isRealBuilderEnabled, type BuildJob } from "@/shared/lib/builderApi";
import type { BuildEventsResponse, BuildSpecSnapshotResponse } from "@/shared/lib/builderApi.schema";
import type { BuildListItem } from "@/shared/lib/types";
import { demoHistory, mapBuildSummary } from "./index";

/** The demo has no such surface. Not a failure of a request: there is nothing to ask. */
export class MockUnsupportedError extends Error {
  readonly mockUnsupported = true as const;
  constructor(message: string) {
    super(message);
    this.name = "MockUnsupportedError";
  }
}

/**
 * What the run screens ask for. A job method resolves with the job as Builder's contract
 * shapes it and rejects with an `ApiError` carrying Builder's status when it is refused
 * (404 for a run the registry does not have). Every method rejects, without an answer,
 * when `signal` is already aborted.
 */
export interface RunsClient {
  /** `POST /builds`. The `run_id` of the answer is the run's id, whatever was asked for. */
  submitBuild(
    specYaml: string,
    runId?: string,
    signal?: AbortSignal,
    retryOf?: string,
    ifAbsent?: boolean,
  ): Promise<BuildJob>;
  /** `GET /builds/{run_id}`. 404 for a run the registry does not have. */
  getBuildJob(runId: string, signal?: AbortSignal): Promise<BuildJob>;
  /** `POST /builds/{run_id}/cancel`. The job as it is after the request: it may still be ending. */
  cancelBuildJob(runId: string, signal?: AbortSignal): Promise<BuildJob>;
  /** The run history, newest first, as the list screens read it. */
  listBuilds(limit?: number): Promise<BuildListItem[]>;
  /** `GET /builds/{run_id}/spec`. 404 for a run with no snapshot. */
  getBuildSpecSnapshot(runId: string, signal?: AbortSignal): Promise<BuildSpecSnapshotResponse>;
  /** `GET /builds/{run_id}/events`. */
  getBuildEvents(
    runId: string,
    options?: { limit?: number; tail?: boolean },
    signal?: AbortSignal,
  ): Promise<BuildEventsResponse>;
}

/** The real client. `listBuilds` maps Builder's summaries with `mapSummary`. */
export function createRealRunsClient(
  mapSummary: (summary: Awaited<ReturnType<typeof builderApi.listBuilds>>["builds"][number]) => BuildListItem,
): RunsClient {
  return {
    submitBuild: async (specYaml, runId, signal, retryOf, ifAbsent) =>
      builderApi.submitBuild(specYaml, runId, signal, retryOf, ifAbsent),
    getBuildJob: async (runId, signal) => builderApi.getBuildJob(runId, signal),
    cancelBuildJob: async (runId, signal) =>
      signal ? builderApi.cancelBuildJob(runId, signal) : builderApi.cancelBuildJob(runId),
    listBuilds: async (limit) => (await builderApi.listBuilds(limit)).builds.map(mapSummary),
    getBuildSpecSnapshot: async (runId, signal) => builderApi.getBuildSpecSnapshot(runId, signal),
    getBuildEvents: async (runId, options, signal) => builderApi.getBuildEvents(runId, options, signal),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function unknownRun(runId: string): ApiError {
  return new ApiError(404, i18n.t("runs.errors.notFound", { buildId: runId }));
}

export interface DemoRunsOptions {
  /**
   * How many times a submitted job is read before it has ended. 0, the demo's own: the
   * submission itself answers a job that has succeeded. With more, the job is `queued`
   * at submission, `running` at each read before the last, then `succeeded` — unless it
   * was cancelled, which ends it `cancelled` at the next read.
   */
  pollsUntilDone?: number;
  /** The clock a job's times are read from. */
  now?: () => string;
}

/**
 * A demo client over `history`: the runs its list shows. The demo uses its fixtures; a
 * test gives its own to reach what they do not hold.
 */
export function createDemoRunsClient(
  history: () => BuildListItem[],
  { pollsUntilDone = 0, now = () => new Date().toISOString() }: DemoRunsOptions = {},
): RunsClient {
  const jobs = new Map<string, { job: BuildJob; readsLeft: number; cancelled: boolean }>();
  let submitted = 0;

  const ended = (job: BuildJob, status: "succeeded" | "cancelled"): BuildJob => ({
    ...job,
    status,
    updated_at: now(),
    response:
      status === "succeeded"
        ? { status: "ok", run_id: job.run_id, outcomes: [], manifest: `output/${job.run_id}/manifest.json` }
        : null,
  });

  return {
    async submitBuild(_specYaml, runId, signal, retryOf) {
      throwIfAborted(signal);
      submitted += 1;
      const id = runId ?? `demo-run-${submitted}`;
      // A submission under an id the registry has answers that job, as a Builder does.
      const known = jobs.get(id);
      if (known) return structuredClone(known.job);
      const at = now();
      const queued: BuildJob = {
        run_id: id,
        status: "queued",
        created_at: at,
        updated_at: at,
        created_by: "demo",
        ...(retryOf ? { retry_of: retryOf } : {}),
      };
      const job = pollsUntilDone === 0 ? ended(queued, "succeeded") : queued;
      jobs.set(id, { job, readsLeft: pollsUntilDone, cancelled: false });
      return structuredClone(job);
    },
    async getBuildJob(runId, signal) {
      throwIfAborted(signal);
      const entry = jobs.get(runId);
      if (!entry) throw unknownRun(runId);
      if (entry.job.status === "queued" || entry.job.status === "running" || entry.job.status === "cancelling") {
        entry.readsLeft -= 1;
        if (entry.cancelled) entry.job = ended(entry.job, "cancelled");
        else if (entry.readsLeft <= 0) entry.job = ended(entry.job, "succeeded");
        else entry.job = { ...entry.job, status: "running", updated_at: now() };
      }
      return structuredClone(entry.job);
    },
    async cancelBuildJob(runId, signal) {
      throwIfAborted(signal);
      const entry = jobs.get(runId);
      if (!entry) throw unknownRun(runId);
      if (entry.job.status === "queued" || entry.job.status === "running") {
        entry.cancelled = true;
        entry.job = { ...entry.job, status: "cancelling", updated_at: now() };
      }
      return structuredClone(entry.job);
    },
    async listBuilds(limit) {
      const runs = history();
      return structuredClone(limit === undefined ? runs : runs.slice(0, limit));
    },
    async getBuildSpecSnapshot(_runId, signal) {
      throwIfAborted(signal);
      throw new MockUnsupportedError(i18n.t("runs.mock.noSpecSnapshot"));
    },
    async getBuildEvents(_runId, _options, signal) {
      throwIfAborted(signal);
      throw new MockUnsupportedError(i18n.t("runs.mock.noRunEvents"));
    },
  };
}

let clients: { real: RunsClient; demo: RunsClient } | null = null;

/**
 * The client in force: Builder's when one is configured, the demo's otherwise.
 *
 * The two are made at the first call, not when this module loads: `./index` owns the
 * mapping of a Builder summary and the demo's history, and imports this module.
 */
export function runsClient(): RunsClient {
  clients ??= {
    real: createRealRunsClient(mapBuildSummary),
    demo: createDemoRunsClient(demoHistory),
  };
  return isRealBuilderEnabled() ? clients.real : clients.demo;
}
