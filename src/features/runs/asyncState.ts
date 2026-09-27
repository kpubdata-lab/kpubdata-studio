/**
 * State and its loader for one Builder query surface (#379).
 *
 * Builds screen holds independent state per surface (Quality/Artifact/BuildSpec snapshot,
 * etc.) and keeps showing remaining surfaces even if one fails (#255 §8/§13) — this type
 * is that unit.
 */
import { useEffect, useState } from "react";

import { classifyRunApiError } from "@/features/runs/model";

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "error"; error: string; notFound?: boolean; permissionDenied?: boolean };

export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  errorMessage: string,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "loaded", data });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const kind = classifyRunApiError(cause);
        setState({
          status: "error",
          error: cause instanceof Error ? cause.message : errorMessage,
          notFound: kind === "not_found",
          permissionDenied: kind === "permission_denied",
        });
      });
    return () => controller.abort();
  }, deps);

  return state;
}
