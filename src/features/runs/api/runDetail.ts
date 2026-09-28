/**
 * Builds/Runs master-detail (#255) detail panel exclusive API: BuildSpec snapshot (#487)
 * and structured run events (#496).
 *
 * Confirmed both endpoints actually exist in Builder main OpenAPI
 * (`GET /builds/{run_id}/spec`, `GET /builds/{run_id}/events`). Mock mode has no
 * deterministic fixture for these surfaces; instead of pretending, throw explicit
 * "not supported in mock mode" to require switching to live mode.
 */
import { i18n } from "@/shared/i18n";
import {
  ApiError,
  builderApi,
  isRealBuilderEnabled,
  type BuildEventsResponse,
  type BuildSpecSnapshotResponse,
} from "@/shared/lib/builderApi";

export class MockUnsupportedError extends Error {
  readonly mockUnsupported = true as const;
  constructor(message: string) {
    super(message);
    this.name = "MockUnsupportedError";
  }
}

/** GET /builds/{run_id}/spec — canonical BuildSpec snapshot used during execution (#487). */
export async function getBuildSpecSnapshot(
  runId: string,
  signal?: AbortSignal,
): Promise<BuildSpecSnapshotResponse> {
  if (!isRealBuilderEnabled()) {
    throw new MockUnsupportedError(
      i18n.t("runs.mock.noSpecSnapshot"),
    );
  }
  return builderApi.getBuildSpecSnapshot(runId, signal);
}

/** GET /builds/{run_id}/events — structured run event timeline (#496). */
export async function getBuildEvents(
  runId: string,
  options?: { limit?: number; tail?: boolean },
  signal?: AbortSignal,
): Promise<BuildEventsResponse> {
  if (!isRealBuilderEnabled()) {
    throw new MockUnsupportedError(
      i18n.t("runs.mock.noRunEvents"),
    );
  }
  return builderApi.getBuildEvents(runId, options, signal);
}

/** Helper to distinguish 404 (legacy run without snapshot) from other errors. */
export function isSnapshotUnavailable(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404;
}
