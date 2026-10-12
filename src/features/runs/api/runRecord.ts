/**
 * One run, read as Studio's `BuildRun` (#120, F02) — what each runs client answers for
 * `getRun` (#902).
 *
 * From a Builder, its current contract is the authoritative source:
 *  - BuildSpec: `GET /builds/{run_id}/spec` snapshot is canonical (if created in
 *    other browsers/CLI, edit is possible even without spec in localStorage);
 *    fallback to local `specStore` only when snapshot 404 (legacy run).
 *  - status: never assume succeeded arbitrarily. Use terminal summary status if present
 *    in `GET /builds` list; if not, use authoritative `GET /builds/{run_id}/manifest`
 *    `status` (ok→succeeded / failed→failed / cancelled→cancelled); if neither has it,
 *    the job's own status when the job has ended (#846 — a run that never started has
 *    only its job). If none of the three says, do not guess; handle as explicit error.
 *
 * In the demo, the deterministic history holds the entire BuildSpec; it is used as-is.
 */
import { i18n } from "@/shared/i18n";
import { redactSpecForStorage } from "@/features/build-spec/specStore";
import { fromYamlText } from "@/features/build-spec/yamlText";
import { ApiError, builderApi, type BuildJob } from "@/shared/lib/builderApi";
import type { BuildListItem, BuildRun, BuildRunStatus, BuildSpec } from "@/shared/lib/types";
import { mapBuildSummary, mockBuilds } from "./history";

/**
 * Map authoritative manifest `status` to Studio BuildRunStatus. Legacy/partial
 * manifests without `status` field return null (no guessing).
 */
async function resolveManifestStatus(runId: string, signal?: AbortSignal): Promise<BuildRunStatus | null> {
  try {
    const manifest = await builderApi.getBuildManifest(runId, signal);
    switch (manifest.status) {
      case "ok":
        return "succeeded";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** How a job can have ended. A job still queued or running has not ended, and is not read here. */
const ENDED: readonly BuildRunStatus[] = ["succeeded", "failed", "cancelled"];

/**
 * The status of a job that has ended, or null (#846).
 *
 * A run Builder failed before it started — its provider keys were gone while it
 * waited — has no run directory: it is in no history list and has no manifest. Its job
 * still says how it ended. Null when its status is one this Studio does not know, or
 * when the job has not ended: a run still in progress was never loaded from here, and
 * the pages that take a run from here (edit, run, publish) are written for one that has
 * ended.
 */
export function endedJobStatus(job: BuildJob): { status: BuildRunStatus; startedAt: string } | null {
  const status = ENDED.find((known) => known === job.status);
  return status ? { status, startedAt: job.created_at } : null;
}

async function resolveJobStatus(
  runId: string,
  signal?: AbortSignal,
): Promise<{ status: BuildRunStatus; startedAt: string } | null> {
  try {
    return endedJobStatus(await builderApi.getBuildJob(runId, signal));
  } catch {
    return null;
  }
}

/** A run as a Builder knows it. `storedSpec` is what this browser saved for it, if anything. */
export async function readBuilderRun(
  buildId: string,
  storedSpec: BuildSpec | null,
  signal?: AbortSignal,
): Promise<BuildRun> {
  // 1) BuildSpec: Builder snapshot is authoritative; fallback to local only on 404 (legacy).
  let spec: BuildSpec | null = null;
  try {
    const snapshot = await builderApi.getBuildSpecSnapshot(buildId, signal);
    // Canonical YAML redacted by Builder. Upon restore, normalize again at storage boundary
    // so secret-keyed values become recognizable `[REDACTED]` markers — existing S07 marker
    // detection/fail-closed logic continues to work. Raw credentials are not restored.
    spec = redactSpecForStorage(fromYamlText(snapshot.spec));
  } catch (cause) {
    // Fallback to local specStore only on legacy 404. Auth/network/parse errors are
    // exposed as-is, not masked as "no info".
    if (!(cause instanceof ApiError && cause.status === 404)) {
      throw cause;
    }
    if (storedSpec) {
      spec = storedSpec;
    }
  }

  if (!spec) {
    throw new Error(i18n.t("runs.errors.notFoundNoSpec", { buildId }));
  }

  // 2) status: GET /builds list > authoritative manifest.status > the job (a run that
  //    never started has only that) > explicit error.
  const items: BuildListItem[] = await builderApi
    .listBuilds(undefined, signal)
    .then((response) => response.builds.map(mapBuildSummary))
    .catch(() => [] as BuildListItem[]);
  const item = items.find((candidate) => candidate.id === buildId);
  if (item) {
    return {
      id: buildId,
      spec,
      status: item.status,
      startedAt: item.startedAt ?? "",
      finishedAt: item.finishedAt ?? undefined,
    };
  }

  const manifestStatus = await resolveManifestStatus(buildId, signal);
  if (manifestStatus) {
    return { id: buildId, spec, status: manifestStatus, startedAt: "", finishedAt: undefined };
  }

  const job = await resolveJobStatus(buildId, signal);
  if (job) {
    return { id: buildId, spec, status: job.status, startedAt: job.startedAt, finishedAt: undefined };
  }

  throw new Error(i18n.t("runs.errors.statusUnknown", { buildId }));
}

/**
 * A run as the demo knows it: a fixture run, or a job the demo was given in this page
 * load (`job`), whose spec this browser saved when it was submitted.
 */
export function readDemoRun(buildId: string, storedSpec: BuildSpec | null, job: BuildJob | undefined): BuildRun {
  const mockRun = mockBuilds().find((candidate) => candidate.id === buildId);
  if (mockRun) {
    return storedSpec ? { ...mockRun, spec: storedSpec } : mockRun;
  }
  if (job && storedSpec) {
    // Like a Builder's: a job that has not ended has no status to load the run with.
    const ended = endedJobStatus(job);
    if (!ended) throw new Error(i18n.t("runs.errors.statusUnknown", { buildId }));
    return { id: buildId, spec: storedSpec, status: ended.status, startedAt: ended.startedAt, finishedAt: job.updated_at };
  }
  if (storedSpec) {
    return { id: buildId, spec: storedSpec, status: "succeeded" as const, startedAt: "" };
  }
  throw new Error(i18n.t("runs.errors.notFound", { buildId }));
}
