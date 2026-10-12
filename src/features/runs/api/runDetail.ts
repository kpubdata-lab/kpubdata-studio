/**
 * Builds/Runs master-detail (#255) detail panel exclusive API: BuildSpec snapshot (#487)
 * and structured run events (#496).
 *
 * Confirmed both endpoints actually exist in Builder main OpenAPI
 * (`GET /builds/{run_id}/spec`, `GET /builds/{run_id}/events`). The demo has no
 * deterministic fixture for these surfaces; instead of pretending, its runs client
 * refuses with `MockUnsupportedError` (#902).
 */
import {
  ApiError,
  type BuildEventsResponse,
  type BuildSpecSnapshotResponse,
} from "@/shared/lib/builderApi";
import { runsClient } from "./client";

export { MockUnsupportedError } from "./client";

/** GET /builds/{run_id}/spec — canonical BuildSpec snapshot used during execution (#487). */
export async function getBuildSpecSnapshot(
  runId: string,
  signal?: AbortSignal,
): Promise<BuildSpecSnapshotResponse> {
  return runsClient().getSpec(runId, signal);
}

/** GET /builds/{run_id}/events — structured run event timeline (#496). */
export async function getBuildEvents(
  runId: string,
  options?: { limit?: number; tail?: boolean },
  signal?: AbortSignal,
): Promise<BuildEventsResponse> {
  return runsClient().getEvents(runId, options, signal);
}

/** Helper to distinguish 404 (legacy run without snapshot) from other errors. */
export function isSnapshotUnavailable(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404;
}
