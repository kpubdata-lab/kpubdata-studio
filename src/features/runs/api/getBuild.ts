/**
 * Build execution info query API (#120, F02).
 *
 * In mock mode, deterministic mock history holds the entire BuildSpec; use it as-is.
 *
 * In live mode, use Builder current contract as authoritative source:
 *  - BuildSpec: `GET /builds/{run_id}/spec` snapshot is canonical (if created in
 *    other browsers/CLI, edit is possible even without spec in localStorage);
 *    fallback to local `specStore` only when snapshot 404 (legacy run).
 *  - status: never assume succeeded arbitrarily. Use terminal summary status if present
 *    in `GET /builds` list; if not, use authoritative `GET /builds/{run_id}/manifest`
 *    `status` (ok→succeeded / failed→failed / cancelled→cancelled). If both unavailable,
 *    do not guess; handle as explicit error.
 */
import { i18n } from "@/shared/i18n";
import { loadBuildSpec, redactSpecForStorage } from "@/features/build-spec/specStore";
import { fromYamlText } from "@/features/build-spec/yamlText";
import { ApiError, builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { BuildListItem, BuildRun, BuildRunStatus, BuildSpec } from "@/shared/lib/types";
import { listBuilds, mockBuilds } from "./index";

/**
 * Map authoritative manifest `status` to Studio BuildRunStatus. Legacy/partial
 * manifests without `status` field return null (no guessing).
 */
async function resolveManifestStatus(runId: string): Promise<BuildRunStatus | null> {
  try {
    const manifest = await builderApi.getBuildManifest(runId);
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

const RUN_STATUSES: readonly BuildRunStatus[] = ["queued", "running", "cancelling", "succeeded", "failed", "cancelled"];

/**
 * The status of a run that has a job and nothing else (#846).
 *
 * A run Builder failed before it started — its provider keys were gone while it
 * waited — has no run directory: it is in no history list and has no manifest. Its job
 * still says how it ended. Null when there is no job either, or its status is one this
 * Studio does not know.
 */
async function resolveJobStatus(runId: string): Promise<{ status: BuildRunStatus; startedAt: string } | null> {
  try {
    const job = await builderApi.getBuildJob(runId);
    const status = RUN_STATUSES.find((known) => known === job.status);
    return status ? { status, startedAt: job.created_at } : null;
  } catch {
    return null;
  }
}

/**
 * Query build execution info by buildId.
 *
 * @param buildId - Build ID to query (run_id).
 * @returns Build execution info.
 * @throws Error if spec or status cannot be determined authoritatively.
 */
export async function getBuild(buildId: string): Promise<BuildRun> {
  if (!buildId) {
    throw new Error(i18n.t("runs.errors.missingId"));
  }

  const storedSpec = loadBuildSpec(buildId);

  // Mock mode: deterministic mock history holds entire BuildSpec; use as-is.
  if (!isRealBuilderEnabled()) {
    const mockRun = mockBuilds().find((candidate) => candidate.id === buildId);
    if (mockRun) {
      return storedSpec ? { ...mockRun, spec: storedSpec } : mockRun;
    }
    if (storedSpec) {
      return { id: buildId, spec: storedSpec, status: "succeeded" as const, startedAt: "" };
    }
    throw new Error(i18n.t("runs.errors.notFound", { buildId }));
  }

  // --- Live mode ---

  // 1) BuildSpec: Builder snapshot is authoritative; fallback to local only on 404 (legacy).
  let spec: BuildSpec | null = null;
  try {
    const snapshot = await builderApi.getBuildSpecSnapshot(buildId);
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
    throw new Error(
      i18n.t("runs.errors.notFoundNoSpec", { buildId }),
    );
  }

  // 2) status: GET /builds list > authoritative manifest.status > the job (a run that
  //    never started has only that) > explicit error.
  const items: BuildListItem[] = await listBuilds().catch(() => [] as BuildListItem[]);
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

  const manifestStatus = await resolveManifestStatus(buildId);
  if (manifestStatus) {
    return { id: buildId, spec, status: manifestStatus, startedAt: "", finishedAt: undefined };
  }

  const job = await resolveJobStatus(buildId);
  if (job) {
    return { id: buildId, spec, status: job.status, startedAt: job.startedAt, finishedAt: undefined };
  }

  throw new Error(
    i18n.t("runs.errors.statusUnknown", { buildId }),
  );
}
