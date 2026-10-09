/**
 * Build run API entry point.
 *
 * In real integration mode (`VITE_USE_REAL_BUILDER=true`), calls Builder `/build`;
 * otherwise returns deterministic mock results. Builder's /build is currently
 * synchronous; async job polling will expand when Builder provides job endpoints (#39).
 */
import { i18n } from "@/shared/i18n";
import { saveBuildSpec } from "@/features/build-spec/specStore";
import { serializeSpec } from "@/features/build-spec/specMapping";
import { builderApi, isRealBuilderEnabled, type BuildJob, type BuildSummary } from "@/shared/lib/builderApi";
import { buildJobResponseSchema, type BuildJobResponse } from "@/shared/lib/builderApi.schema";
import { DEMO_DATASETS, type DemoDataset } from "@/shared/lib/demoDatasets";
import { keysWereLost } from "@/shared/lib/missingProviderKey";
import type { BuildListItem, BuildRun, BuildRunStatus, BuildSpec } from "@/shared/lib/types";

const MOCK_TIME = "1970-01-01T00:00:00.000Z";

/** How many run ids this page load has made. Part of each id, so no two are the same. */
let issuedRunIds = 0;

/** Four characters of `[a-z0-9]` from the platform's random source. */
function randomSuffix(): string {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return (values[0]! % 36 ** 4).toString(36).padStart(4, "0");
}

/**
 * Generate path-safe run_id from BuildSpec.
 *
 * Builder uses run_id as output directory name, so only safe segments
 * (alphanumeric/hyphen) are kept: `<dataset slug>-<milliseconds>-<count><random>`.
 *
 * The time alone is not an identity (#815): two builds of one dataset made in the same
 * millisecond got the same id, and Builder answers a submission under an id it already
 * has with the existing job — the second build did not run. So each id also carries
 * the count of ids this page load has made, which makes two from one tab differ
 * whatever the clock says, and four random characters, which keep two tabs apart. The
 * count is variable-length and the random part fixed, so ids with different counts
 * never spell the same string.
 */
export function generateRunId(datasetId: string): string {
  const slug = datasetId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const base = slug.length > 0 ? slug : "build";
  issuedRunIds += 1;
  return `${base}-${Date.now()}-${issuedRunIds.toString(36)}${randomSuffix()}`;
}

/**
 * Start a new build execution and return execution results.
 *
 * @param spec - BuildSpec to execute.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns Generated build execution info.
 */
/** Map Builder job status to Studio execution status (builder 1.16.0 #480). */
export type BuilderJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * The run a build was submitted as, for the caller (useBuildJob): POST /builds and
 * polling, with cancel sent as POST /builds/{run_id}/cancel.
 *
 * Every build takes this path, file sources included (#786). They used to go through the
 * synchronous POST /build (ADR 0014), which held one request open for the whole build —
 * as long as a browser or a proxy would wait — and could not be cancelled on the server.
 * Builder's async worker reads the submitter's uploads since kpubdata-builder#998, and
 * every Builder Studio supports (`MIN_BUILDER_API_VERSION`) has it.
 */
export interface BuildExecutionHandle {
  runId: string;
  mode: "async";
}

export interface BuildExecutionOptions {
  /**
   * The earlier run this build retries (#757, builder#1042). Builder records it on the
   * new run; the earlier run is left as it ended.
   */
  retryOf?: string;
  /**
   * The build must make new tables (builder#1223): Builder refuses to commit over a table
   * that already has a snapshot, in the commit's own transaction. Sent for Add Data's
   * "new table" choice; a refresh leaves it out.
   */
  ifAbsent?: boolean;
}

/**
 * What to send as `retry_of` when a build is started from an earlier run's page (#757).
 *
 * Only a run that failed or was cancelled is retried (kpubdata#812: a retry is a new run
 * that points at the earlier attempt). Running a succeeded run's spec again is a refresh —
 * a new result, not a second attempt at the old one — and names nothing.
 */
export function retryOfFor(earlier: { id: string; status: BuildRunStatus } | null | undefined): string | undefined {
  if (!earlier) return undefined;
  return earlier.status === "failed" || earlier.status === "cancelled" ? earlier.id : undefined;
}

export async function executeBuild(
  spec: BuildSpec,
  signal?: AbortSignal,
  onJobStatus?: (status: BuilderJobStatus) => void,
  onHandle?: (handle: BuildExecutionHandle) => void,
  options: BuildExecutionOptions = {},
): Promise<BuildRun> {
  if (!isRealBuilderEnabled()) {
    const mockRun: BuildRun = {
      id: "mock-run",
      spec,
      status: "succeeded",
      startedAt: MOCK_TIME,
      finishedAt: MOCK_TIME,
    };
    // In mock mode, save spec so edit flow can be validated with same path as real mode.
    saveBuildSpec(mockRun.id, spec);
    return mockRun;
  }

  // In real integration mode, record actual execution time (avoid incorrect 1970 values
  // in history/detail screens).
  const runId = generateRunId(spec.datasetId);
  const startedAt = new Date().toISOString();

  // Every source kind, file included, goes through the async job surface (#786). The
  // handle is exposed only after POST /builds succeeds and returns the authoritative
  // run_id (F03), so a Cancel pressed while the submit is in flight never reaches a
  // run_id the server does not have.
  const result = await runAsyncBuild(
    spec,
    runId,
    startedAt,
    signal,
    onJobStatus,
    onHandle,
    options.retryOf,
    options.ifAbsent,
  );

  // Builder does not persist spec (#120), so Studio saves the spec bound to
  // run_id for edit screen restoration. Save failures are ignored and do not
  // affect build results. It was saved when the job was submitted too; this keeps
  // it under the id the finished job reports.
  saveBuildSpec(result.id, spec);

  return result;
}

export const POLL_INTERVAL_MS = 800;

/** Terminal (#245): polling stops when reaching this status. */
export function isTerminalBuilderStatus(status: BuilderJobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Starting from already-fetched `initialJob`, poll `GET /builds/{run_id}` until
 * terminal state (succeeded/failed/cancelled) (#245 polling state machine reuse).
 *
 * Shared by both newly submitted build (runAsyncBuild) and watching existing runs
 * (Builds/Runs master-detail, #255) — no need for second polling state machine.
 */
export async function pollBuildJobUntilTerminal(
  runId: string,
  initialJob: Awaited<ReturnType<typeof builderApi.getBuildJob>>,
  signal: AbortSignal | undefined,
  onJobStatus?: (job: Awaited<ReturnType<typeof builderApi.getBuildJob>>) => void,
): Promise<Awaited<ReturnType<typeof builderApi.getBuildJob>>> {
  let job = initialJob;
  while (!isTerminalBuilderStatus(job.status)) {
    await sleep(POLL_INTERVAL_MS, signal);
    job = await builderApi.getBuildJob(runId, signal);
    onJobStatus?.(job);
  }
  return job;
}

async function runAsyncBuild(
  spec: BuildSpec,
  runId: string,
  startedAt: string,
  signal: AbortSignal | undefined,
  onJobStatus: ((status: BuilderJobStatus) => void) | undefined,
  onHandle: ((handle: BuildExecutionHandle) => void) | undefined,
  retryOf?: string,
  ifAbsent?: boolean,
): Promise<BuildRun> {
  const submitted = await builderApi.submitBuild(serializeSpec(spec), runId, signal, retryOf, ifAbsent);
  // Server-returned run_id is authoritative. Only from here can cooperative cancel
  // (POST /builds/{run_id}/cancel) be sent — before submit, Cancel is kept as pending
  // intent and applied exactly once via handle exposed here (F03).
  // Kept now, not when the run ends (#846). A job can wait an hour for a worker; the
  // user leaves, the tab closes or polling fails long before that, and a run that then
  // never starts has no spec anywhere else — Builder snapshots it only once it runs.
  // Before the handle is handed out: a caller that opens the run's page at once (Add
  // Data, #842) finds the spec already there.
  saveBuildSpec(submitted.run_id, spec);
  onHandle?.({ runId: submitted.run_id, mode: "async" });
  onJobStatus?.(submitted.status);

  // If terminal immediately after submit (same run_id resubmit, etc.), decide
  // without polling.
  const job = await pollBuildJobUntilTerminal(submitted.run_id, submitted, signal, (polled) =>
    onJobStatus?.(polled.status),
  );

  return buildRunFromJob(job, spec, startedAt);
}

/**
 * What a job whose table was not committed should say (#881), or null when none was refused.
 *
 * Read from `warehouse_failures` by reason; the source key names the table. A reason this
 * Studio does not know is shown as a refused commit, never dropped.
 */
export function warehouseFailureMessage(body: BuildJobResponse | null): string | null {
  const failures = body?.warehouse_failures;
  if (!failures) return null;
  const first = Object.entries(failures)[0];
  if (!first) return null;
  const [table, failure] = first;
  switch (failure.reason) {
    case "table_exists":
      return i18n.t("runs.build.tableExists", { table });
    case "empty_result":
      return i18n.t("runs.build.emptyResult", { table });
    case "conflict":
      return i18n.t("runs.build.commitConflict", { table });
    default:
      return i18n.t("runs.build.commitFailed", { table });
  }
}

/**
 * Decide a terminal async job's BuildRun (#603).
 *
 * The job's own `status` and `error` decide first: a failed job shows Builder's reason,
 * whatever its `response` holds. A succeeded job's `response` is contract-typed only as
 * `object | null`, so it is narrowed to the fields read here — a body that says
 * `status: "failed"` is a partial failure (same wire as sync /build 502), reported with
 * priority topmost error → outcomes[].error → default message (#75). A body without a
 * usable shape (absent, null, minimal `{run_id, status: "ok"}`) leaves the job succeeded.
 */
export function buildRunFromJob(job: BuildJob, spec: BuildSpec, startedAt: string): BuildRun {
  const finishedAt = job.updated_at;
  // run_id is authoritative from server response (same as submitted but unified from
  // response).
  const finalRunId = job.run_id;
  if (job.status === "cancelled") {
    return { id: finalRunId, spec, status: "cancelled", startedAt, finishedAt };
  }
  const parsed = job.response ? buildJobResponseSchema.safeParse(job.response) : null;
  const body = parsed?.success ? parsed.data : null;
  if (job.status === "failed") {
    return {
      id: finalRunId,
      spec,
      status: "failed",
      startedAt,
      finishedAt,
      // A table Builder refused to commit says why in Builder's own words (#881); the
      // job's error is then only "build failed".
      error: warehouseFailureMessage(body) ?? (job.error || body?.error || i18n.t("runs.build.jobFailed")),
      ...(keysWereLost(job) ? { keysLost: true } : {}),
    };
  }
  if (body?.status !== undefined && body.status !== "ok") {
    const outcomeReason = body.outcomes?.find((outcome) => outcome.error)?.error;
    const reason = body.error || outcomeReason || i18n.t("runs.build.someSourcesFailed");
    return { id: finalRunId, spec, status: "failed", startedAt, finishedAt, error: reason };
  }
  return { id: finalRunId, spec, status: "succeeded", startedAt, finishedAt };
}

/**
 * Map Builder `GET /builds` BuildSummary.status (canonical vocab: ok/failed/cancelled)
 * to Studio BuildRunStatus.
 *
 * Cancelled runs come as `cancelled` and never collapse to failed (#S04). Values
 * outside Builder vocab fail-closed (failed), not silently as success.
 */
function mapBuildSummaryStatus(status: BuildSummary["status"]): BuildRunStatus {
  switch (status) {
    case "ok":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

/** Convert demo catalog entry to BuildSpec for list/history UI. */
function mockSpec(dataset: DemoDataset): BuildSpec {
  return {
    datasetId: dataset.slug,
    title: dataset.title,
    description: dataset.description,
    sources: [
      {
        provider: "datago",
        dataset: dataset.providerDataset,
        params: dataset.params,
      },
    ],
    exports: dataset.exports,
    metadata: {
      source_url: dataset.sourceUrl,
      hf_repo: dataset.hfRepo,
    },
  };
}

/** Deterministic build history for mock mode (based on real builder dataset specs). */
export function mockBuilds(): BuildRun[] {
  return DEMO_DATASETS.map((dataset) => ({
    id: dataset.buildId,
    spec: mockSpec(dataset),
    status: dataset.status,
    startedAt: dataset.startedAt,
    finishedAt: dataset.finishedAt,
  }));
}

/**
 * List build execution history (#12, #95, #153).
 *
 * In mock mode (`VITE_USE_REAL_BUILDER` unset), returns deterministic mock list
 * for developing/verifying list/search/sort UI.
 *
 * In real integration mode, calls Builder `GET /builds` and maps response to
 * BuildListItem[] (#153, builder #250). Since kpubdata-builder#844 each run names its
 * table (`dataset_id`, `dataset_title`) and snapshot; an older Builder omits them.
 *
 * @param limit - Optional limit parameter. Omit to use Builder default (50).
 * @returns Build execution list (mock mode: deterministic mock, real integration
 *          mode: Builder response mapped).
 */
export async function listBuilds(limit?: number): Promise<BuildListItem[]> {
  if (!isRealBuilderEnabled()) {
    // The demo runs name their table; they committed no warehouse snapshot, so the
    // snapshot fields stay unsent.
    return mockBuilds().map((run) => ({
      id: run.id,
      title: run.spec.title,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      datasetId: run.spec.datasetId,
    }));
  }

  const response = await builderApi.listBuilds(limit);
  return response.builds.map(mapBuildSummary);
}

/**
 * One `GET /builds` row as a list item. The table and snapshot fields
 * (kpubdata-builder#844) keep `undefined` when an older Builder omits them, so the table
 * can tell "not sent" from "sent as null".
 */
export function mapBuildSummary(summary: BuildSummary): BuildListItem {
  return {
    id: summary.run_id,
    title: summary.dataset_title ?? null,
    status: mapBuildSummaryStatus(summary.status),
    // Normalize missing or null to explicit null.
    startedAt: summary.started_at ?? null,
    finishedAt: summary.finished_at ?? null,
    datasetId: summary.dataset_id,
    snapshotId: summary.snapshot_id,
    snapshots: summary.snapshots?.map((entry) => ({
      logicalName: entry.logical_name,
      snapshotId: entry.snapshot_id,
    })),
  };
}

