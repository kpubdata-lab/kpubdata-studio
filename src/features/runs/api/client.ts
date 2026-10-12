/**
 * The runs client: one interface, a Builder and a demo behind it (#794, #902).
 *
 * The interface mirrors Builder's job surface — `submit` (`POST /builds`), `getJob`
 * (`GET /builds/{run_id}`), `cancel` (`POST /builds/{run_id}/cancel`) and `list`
 * (`GET /builds`) — so submitting, polling, cancelling and racing take the same path
 * whichever answers. The demo keeps a small job model in memory: a submitted job is
 * `queued`, and each poll moves it on, `queued` → `running` → `succeeded`. Cancelling
 * follows Builder's cooperative rule: a `queued` job ends `cancelled` at once, a `running`
 * one is `cancelling` until the next poll ends it `cancelled`. An unknown run is a 404,
 * cancelling one that has ended a 409, and an aborted request is refused unanswered.
 *
 * Where the demo answers differently, said here rather than hidden:
 * - `list` and `getRun` answer in Studio's model, not Builder's rows. The demo history
 *   holds runs still in progress, which `GET /builds` never lists and its status
 *   vocabulary (`ok`/`failed`/`cancelled`) cannot carry, and its runs carry their whole
 *   spec, which a Builder gives only through `GET /builds/{run_id}/spec`.
 * - The demo history's runs are not in its job registry: `getJob` answers 404 for them,
 *   as a Builder does for a run its registry has let go. Its history does not list the
 *   jobs submitted to it either; they are known by id.
 * - `getSpec` and `getEvents` are refused with `MockUnsupportedError`: the demo has no
 *   snapshot or event log to give, and does not make one up.
 */
import { i18n } from "@/shared/i18n";
import { loadBuildSpec } from "@/features/build-spec/specStore";
import {
  ApiError,
  builderApi,
  isRealBuilderEnabled,
  type BuildEventsResponse,
  type BuildJob,
  type BuildSpecSnapshotResponse,
} from "@/shared/lib/builderApi";
import type { BuildListItem, BuildRun } from "@/shared/lib/types";
import { demoHistory, mapBuildSummary } from "./history";
import { readBuilderRun, readDemoRun } from "./runRecord";

/** A surface the demo has no data for. Said as such, never answered with made-up data. */
export class MockUnsupportedError extends Error {
  readonly mockUnsupported = true as const;
  constructor(message: string) {
    super(message);
    this.name = "MockUnsupportedError";
  }
}

export interface RunsClient {
  /**
   * Whether `list` holds only runs that have ended. Builder's `GET /builds` does; the demo
   * history also holds runs still in progress.
   */
  readonly listsOnlyEnded: boolean;
  /** `POST /builds` — the job Builder accepted, under the run id it answers with. */
  submit(
    specYaml: string,
    runId: string,
    signal?: AbortSignal,
    retryOf?: string,
    ifAbsent?: boolean,
  ): Promise<BuildJob>;
  /** `GET /builds/{run_id}` — the job as it is now; 404 when the registry does not have it. */
  getJob(runId: string, signal?: AbortSignal): Promise<BuildJob>;
  /** `POST /builds/{run_id}/cancel` — asks; 404 for an unknown run, 409 for one that has ended. */
  cancel(runId: string, signal?: AbortSignal): Promise<BuildJob>;
  /** `GET /builds`, as list items. `limit` left out takes Builder's default. */
  list(limit?: number, signal?: AbortSignal): Promise<BuildListItem[]>;
  /** One run with its spec and status (`runRecord.ts`). */
  getRun(runId: string, signal?: AbortSignal): Promise<BuildRun>;
  /** `GET /builds/{run_id}/spec`. */
  getSpec(runId: string, signal?: AbortSignal): Promise<BuildSpecSnapshotResponse>;
  /** `GET /builds/{run_id}/events`. */
  getEvents(
    runId: string,
    options?: { limit?: number; tail?: boolean },
    signal?: AbortSignal,
  ): Promise<BuildEventsResponse>;
}

export const realRunsClient: RunsClient = {
  listsOnlyEnded: true,
  // Arguments are passed on as given, so a call reaches Builder's client exactly as made.
  submit: (...args) => builderApi.submitBuild(...args),
  getJob: (...args) => builderApi.getBuildJob(...args),
  cancel: (...args) => builderApi.cancelBuildJob(...args),
  list: async (limit, signal) => (await builderApi.listBuilds(limit, signal)).builds.map(mapBuildSummary),
  getRun: (runId, signal) => readBuilderRun(runId, loadBuildSpec(runId), signal),
  getSpec: (...args) => builderApi.getBuildSpecSnapshot(...args),
  getEvents: (...args) => builderApi.getBuildEvents(...args),
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

/** The demo's job registry: the jobs submitted in this page load, by run id. */
const demoJobs = new Map<string, BuildJob>();

/** Forget every demo job. For tests, which share one module between cases. */
export function resetDemoJobsForTests(): void {
  demoJobs.clear();
}

function demoJob(runId: string): BuildJob {
  const job = demoJobs.get(runId);
  if (!job) throw new ApiError(404, `run ${runId} not found`);
  return job;
}

/** Store the job with a new status and time, and answer with a copy, as a response would be. */
function moveDemoJob(job: BuildJob, status: BuildJob["status"]): BuildJob {
  const next = { ...job, status, updated_at: new Date().toISOString() };
  demoJobs.set(job.run_id, next);
  return { ...next };
}

/** Where one poll moves a demo job. A job that has ended stays where it is. */
const DEMO_NEXT: Partial<Record<BuildJob["status"], BuildJob["status"]>> = {
  queued: "running",
  running: "succeeded",
  cancelling: "cancelled",
};

export const demoRunsClient: RunsClient = {
  listsOnlyEnded: false,
  async submit(_specYaml, runId, signal, retryOf) {
    throwIfAborted(signal);
    // Like Builder, a run id it already has answers with the job it has.
    const existing = demoJobs.get(runId);
    if (existing) return { ...existing };
    const now = new Date().toISOString();
    const job: BuildJob = {
      run_id: runId,
      status: "queued",
      created_at: now,
      updated_at: now,
      ...(retryOf ? { retry_of: retryOf } : {}),
    };
    demoJobs.set(runId, job);
    return { ...job };
  },
  async getJob(runId, signal) {
    throwIfAborted(signal);
    const job = demoJob(runId);
    const next = DEMO_NEXT[job.status];
    return next ? moveDemoJob(job, next) : { ...job };
  },
  async cancel(runId, signal) {
    throwIfAborted(signal);
    const job = demoJob(runId);
    if (job.status === "queued") return moveDemoJob(job, "cancelled");
    if (job.status === "running") return moveDemoJob(job, "cancelling");
    if (job.status === "cancelling") return { ...job };
    throw new ApiError(409, `run ${runId} has already ended`);
  },
  async list(_limit, signal) {
    throwIfAborted(signal);
    return demoHistory();
  },
  async getRun(runId, signal) {
    throwIfAborted(signal);
    return readDemoRun(runId, loadBuildSpec(runId), demoJobs.get(runId));
  },
  async getSpec() {
    throw new MockUnsupportedError(i18n.t("runs.mock.noSpecSnapshot"));
  },
  async getEvents() {
    throw new MockUnsupportedError(i18n.t("runs.mock.noRunEvents"));
  },
};

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function runsClient(): RunsClient {
  return isRealBuilderEnabled() ? realRunsClient : demoRunsClient;
}
