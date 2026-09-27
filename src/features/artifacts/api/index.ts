/**
 * Entry point for build artifact/manifest lookup APIs.
 *
 * Mock mode returns a deterministic mock manifest so viewer UI can be
 * developed and verified. Real mode (`VITE_USE_REAL_BUILDER=true`) returns
 * the authoritative manifest body of Builder
 * `GET /builds/{run_id}/manifest` verbatim. The deterministic fixture
 * manifest is used only in mock mode.
 */
import { i18n } from "@/shared/i18n";
import { findDemoDataset } from "@/shared/lib/demoDatasets";
import { builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { BuildManifest } from "@/shared/lib/types";

import type { ExportTarget } from "@/shared/lib/types";

/** Response type preserving Builder manifest additive fields only at the API boundary. */
export type AuthoritativeBuildManifest =
  | BuildManifest
  | (BuildManifest & Record<string, unknown>);

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
function mockManifest(buildId: string): BuildManifest {
  const dataset = findDemoDataset(buildId);
  const sourceKey = `datago.${dataset.providerDataset}`;
  const succeeded = dataset.status === "succeeded";

  return {
    schema_version: "1.0.0",
    build_id: buildId,
    started_at: dataset.startedAt,
    finished_at: dataset.finishedAt, // undefined를 허용
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

/**
 * Looks up the manifest of a specific build run.
 *
 * Real mode returns the authoritative body of Builder
 * `GET /builds/{run_id}/manifest`; mock mode returns the deterministic
 * fixture manifest.
 *
 * @param buildId - Build run id to look up.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns Build manifest information.
 */
export async function getBuildManifest(
  buildId: string,
  signal?: AbortSignal,
): Promise<AuthoritativeBuildManifest> {
  if (!isRealBuilderEnabled()) {
    return mockManifest(buildId);
  }

  const result = await builderApi.getBuildManifest(buildId, signal);
  return result as AuthoritativeBuildManifest;
}

/**
 * Lists downloadable artifact files — `GET /artifacts/{run_id}`.
 *
 * Each path in this list is the **canonical artifact identifier**: a POSIX
 * relative path against the exact run workspace, containing no
 * output_root/absolute path/OS separators. Downloads must use this value —
 * `manifest.outputs` holds filesystem storage paths (absolute + OS
 * separators) and cannot serve as a download identifier.
 *
 * @returns Array of file paths relative to the run directory.
 */
export async function listArtifactFiles(
  runId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!isRealBuilderEnabled()) {
    // mock mode: no real workspace, so the deterministic fixture manifest's
    // output list is used as-is (already relative POSIX paths).
    return mockManifest(runId).outputs ?? [];
  }
  const result = await builderApi.artifacts(runId, signal);
  return result.files;
}

/**
 * Fetches an individual artifact file of a run via an authenticated Builder request.
 *
 * `filePath` must be the canonical run-relative POSIX path from
 * `listArtifactFiles` (= `GET /artifacts/{run_id}`) — Studio never mutates
 * the path string. `builderApi.downloadArtifactFile` URL-encodes per
 * segment. Mock mode has no real files, so it explicitly reports
 * unsupported rather than inventing content.
 */
export async function downloadArtifact(
  runId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  if (!isRealBuilderEnabled()) {
    throw new Error(
      i18n.t("artifacts.mockNoDownload"),
    );
  }
  return builderApi.downloadArtifactFile(runId, filePath, signal);
}

/** Triggers a browser download of a Blob under the original filename and revokes the object URL. */
export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}
