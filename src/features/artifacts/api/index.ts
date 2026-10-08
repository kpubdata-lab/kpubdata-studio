/**
 * Entry point for build artifact/manifest lookup APIs.
 *
 * Each function asks the client in force (`./client`): Builder's when one is configured
 * (`VITE_USE_REAL_BUILDER=true`), the demo's otherwise. Which of the two answers is
 * decided there and nowhere in this file (#794).
 */
import { artifactsClient, type AuthoritativeBuildManifest } from "./client";

export type { AuthoritativeBuildManifest } from "./client";

/**
 * Looks up the manifest of a specific build run.
 *
 * Builder answers with the authoritative body of `GET /builds/{run_id}/manifest`; the
 * demo with its deterministic fixture manifest.
 *
 * @param buildId - Build run id to look up.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns Build manifest information.
 */
export function getBuildManifest(buildId: string, signal?: AbortSignal): Promise<AuthoritativeBuildManifest> {
  return artifactsClient().getBuildManifest(buildId, signal);
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
export function listArtifactFiles(runId: string, signal?: AbortSignal): Promise<string[]> {
  return artifactsClient().listArtifactFiles(runId, signal);
}

/**
 * Fetches an individual artifact file of a run via an authenticated Builder request.
 *
 * `filePath` must be the canonical run-relative POSIX path from
 * `listArtifactFiles` (= `GET /artifacts/{run_id}`) — Studio never mutates
 * the path string. `builderApi.downloadArtifactFile` URL-encodes per
 * segment. The demo has no real files, so it explicitly reports
 * unsupported rather than inventing content.
 */
export function downloadArtifact(
  runId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  return artifactsClient().downloadArtifact(runId, filePath, signal);
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
