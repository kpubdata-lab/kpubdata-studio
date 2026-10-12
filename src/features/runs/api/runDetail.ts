/**
 * Builds/Runs master-detail (#255) detail panel exclusive API: BuildSpec snapshot (#487)
 * and structured run events (#496).
 *
 * Confirmed both endpoints actually exist in Builder main OpenAPI
 * (`GET /builds/{run_id}/spec`, `GET /builds/{run_id}/events`). The demo has no
 * fixture for these surfaces: its client (`./client`) rejects with
 * `MockUnsupportedError` instead of pretending.
 */
import { ApiError, type BuildEventsResponse, type BuildSpecSnapshotResponse } from "@/shared/lib/builderApi";
import { MockUnsupportedError, runsClient } from "./client";

export { MockUnsupportedError };

/** GET /builds/{run_id}/spec — canonical BuildSpec snapshot used during execution (#487). */
export async function getBuildSpecSnapshot(
  runId: string,
  signal?: AbortSignal,
): Promise<BuildSpecSnapshotResponse> {
  return runsClient().getBuildSpecSnapshot(runId, signal);
}

/** GET /builds/{run_id}/events — structured run event timeline (#496). */
export async function getBuildEvents(
  runId: string,
  options?: { limit?: number; tail?: boolean },
  signal?: AbortSignal,
): Promise<BuildEventsResponse> {
  return runsClient().getBuildEvents(runId, options, signal);
}

/** Helper to distinguish 404 (legacy run without snapshot) from other errors. */
export function isSnapshotUnavailable(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404;
}
