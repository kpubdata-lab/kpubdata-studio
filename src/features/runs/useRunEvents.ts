/**
 * Hook to query and poll structured event timeline (#496 evidence) for selected Run (#255 P1).
 *
 * Shares same visibility-aware polling primitive as useSelectedRunPolling (#255 §3) — does not create
 * new scheduler. Event query failure managed as fully independent state to keep Run/Stage/Quality/BuildSpec
 * snapshot screen alive (#255 §1).
 *
 * In mock mode, getBuildEvents throws MockUnsupportedError — this is not "network error" but separate
 * signal "this surface unsupported in mock", so expose as mockUnsupported flag to distinguish
 * (don't fabricate data pretending it works).
 */
import { i18n } from "@/shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBuildEvents, MockUnsupportedError } from "@/features/runs/api/runDetail";
import { classifyRunApiError } from "@/features/runs/model";
import { useVisibilityAwarePolling } from "./useVisibilityAwarePolling";
import type { BuildEventsResponse } from "@/shared/lib/builderApi";

/** Run status polling (#245, 800ms) uses tighter interval — event timeline doesn't change as frequently as status. */
export const RUN_EVENTS_POLL_INTERVAL_MS = 3000;

/** Recent events to fetch at once. tail=true always returns latest N chronologically ascending (#496 contract). */
export const RUN_EVENTS_LIMIT = 200;

export type RunEventsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: BuildEventsResponse }
  | {
      status: "error";
      error: string;
      notFound?: boolean;
      permissionDenied?: boolean;
       /** mock mode: this surface itself unsupported (distinct from network/server errors). */
      mockUnsupported?: boolean;
    };

/**
 * @param runId - Run ID to watch. If null, do not query.
 * @param pollingEnabled - Pass true only for non-terminal runs — stop polling if terminal.
 */
export function useRunEvents(runId: string | null, pollingEnabled: boolean): RunEventsState {
  const [state, setState] = useState<RunEventsState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  const fetchNow = useCallback(async () => {
    if (!runId) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const data = await getBuildEvents(runId, { limit: RUN_EVENTS_LIMIT, tail: true }, controller.signal);
      if (controller.signal.aborted) return;
      setState({ status: "loaded", data });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const mockUnsupported = cause instanceof MockUnsupportedError;
      const kind = classifyRunApiError(cause);
      setState({
        status: "error",
        error: cause instanceof Error ? cause.message : i18n.t("runs.errors.eventsFailed"),
        notFound: kind === "not_found",
        permissionDenied: kind === "permission_denied",
        mockUnsupported,
      });
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      controllerRef.current?.abort();
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    void fetchNow();
    return () => {
      controllerRef.current?.abort();
    };
    // fetchNow derives only from runId (useCallback deps: [runId]), so runId alone is sufficient.
  }, [runId]);

  useVisibilityAwarePolling(
    () => void fetchNow(),
    RUN_EVENTS_POLL_INTERVAL_MS,
    Boolean(runId) && pollingEnabled,
  );

  return state;
}
