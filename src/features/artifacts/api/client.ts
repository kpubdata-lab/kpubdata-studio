/**
 * The artifacts client: one interface, and the two things that implement it (#794).
 *
 * As in `features/datasets/api/client.ts`: the screens ask `artifactsClient()` and do not
 * know whether a Builder or the demo answers. `client.contract.test.ts` holds the two to
 * the same expectations. Three things here are the demo's own, and are written down:
 *
 * - the demo has an answer for every run id (an id it does not know reads as its first
 *   dataset), where Builder answers 404;
 * - the demo has a manifest for a run that has not ended, without `finished_at`.
 *   Builder's contract has no such manifest: one is written when a run ends. The
 *   contract test holds this as a known difference rather than hide it;
 * - the demo has no files, so `downloadArtifact` refuses rather than invent content.
 */
import { i18n } from "@/shared/i18n";
import { findDemoDataset } from "@/shared/lib/demoDatasets";
import { builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { BuildManifest, ExportTarget } from "@/shared/lib/types";

/** Response type preserving Builder manifest additive fields only at the API boundary. */
export type AuthoritativeBuildManifest =
  | BuildManifest
  | (BuildManifest & Record<string, unknown>);

/**
 * What the artifact screens ask for. Every method rejects, without an answer, when
 * `signal` is already aborted.
 */
export interface ArtifactsClient {
  /** The manifest of a run, as Builder's contract shapes it. */
  getBuildManifest(runId: string, signal?: AbortSignal): Promise<AuthoritativeBuildManifest>;
  /**
   * The downloadable files of a run: canonical run-relative POSIX paths, with no
   * output root, absolute path or OS separator.
   */
  listArtifactFiles(runId: string, signal?: AbortSignal): Promise<string[]>;
  /**
   * One file of a run. `filePath` is a path `listArtifactFiles` gave, unchanged.
   * The demo has no files and always refuses.
   */
  downloadArtifact(runId: string, filePath: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }>;
}

export const realArtifactsClient: ArtifactsClient = {
  getBuildManifest: async (runId, signal) =>
    (await builderApi.getBuildManifest(runId, signal)) as AuthoritativeBuildManifest,
  listArtifactFiles: async (runId, signal) => (await builderApi.artifacts(runId, signal)).files,
  downloadArtifact: (runId, filePath, signal) => builderApi.downloadArtifactFile(runId, filePath, signal),
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

/**
 * Artifact file extensions per export format. Matched to specMapping's
 * output_path convention (`.../data.<ext>`) so mock/real manifest file
 * listings stay consistent. huggingface is a repository layout, not files,
 * and produces no data file.
 */
const EXPORT_EXTENSION: Record<string, string> = {
  jsonl: "jsonl",
  markdown: "md",
  parquet: "parquet",
  huggingface: "",
};

function exportExtension(target: ExportTarget): string {
  return EXPORT_EXTENSION[target.format] ?? target.format;
}

/**
 * Builds a deterministic mock manifest from the build id (temporary until #30/#29 integration).
 *
 * @param buildId - Build execution id.
 * @returns mock BuildManifest.
 */
export function demoManifest(buildId: string): BuildManifest {
  const dataset = findDemoDataset(buildId);
  const sourceKey = `datago.${dataset.providerDataset}`;
  const succeeded = dataset.status === "succeeded";

  return {
    schema_version: "1.0.0",
    build_id: buildId,
    started_at: dataset.startedAt,
    finished_at: dataset.finishedAt, // allows undefined
    build_environment: {
      python_version: "3.12.3",
      kpubdata_version: "0.4.0",
      builder_version: "0.4.0",
    },
    inputs: succeeded ? [sourceKey] : undefined,
    inputs_fingerprint: succeeded
      ? `sha256:${dataset.slug.replace(/-/g, "").padEnd(64, "0").slice(0, 64)}`
      : null,
    outputs: succeeded
      ? [
          ...dataset.exports
            .filter((target) => target.format !== "huggingface")
            .map(
              (target) =>
                `artifacts/builds/${buildId}/data.${exportExtension(target)}`,
            ),
          `artifacts/builds/${buildId}/README.md`,
          `artifacts/builds/${buildId}/manifest.json`,
        ]
      : undefined,
    warnings: undefined,
    errors: dataset.errors,
    row_counts: succeeded ? { [sourceKey]: dataset.recordCount } : undefined,
    schema_summaries: succeeded
      ? {
          [sourceKey]: {
            fields: dataset.fields,
            total_fields: dataset.fields.length,
          },
        }
      : undefined,
    provenance: succeeded
      ? [
          {
            provider: "datago",
            dataset: dataset.providerDataset,
            fetched_at: dataset.finishedAt ?? dataset.startedAt,
            record_count: dataset.recordCount,
            data_checksum: `sha256:${dataset.slug.replace(/-/g, "").padEnd(64, "1").slice(0, 64)}`,
            api_version: "unknown",
            params: dataset.params,
          },
        ]
      : undefined,
  };
}

export const demoArtifactsClient: ArtifactsClient = {
  async getBuildManifest(runId, signal) {
    throwIfAborted(signal);
    return demoManifest(runId);
  },
  async listArtifactFiles(runId, signal) {
    throwIfAborted(signal);
    // No real workspace, so the fixture manifest's output list is used as it is
    // (already relative POSIX paths).
    return demoManifest(runId).outputs ?? [];
  },
  async downloadArtifact(_runId, _filePath, signal) {
    throwIfAborted(signal);
    throw new Error(i18n.t("artifacts.mockNoDownload"));
  },
};

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function artifactsClient(): ArtifactsClient {
  return isRealBuilderEnabled() ? realArtifactsClient : demoArtifactsClient;
}
