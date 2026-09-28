/**
 * visibility-aware repeated execution helper (#255 §3).
 *
 * Minimal shared primitive for Selected Run status polling (useSelectedRunPolling) and structured Run event
 * polling (useRunEvents) without each creating new scheduler. Only decides whether to start new request,
 * knows nothing about run state judgment logic.
 *
 * Policy:
 * - If document.visibilityState === "hidden", callback not called on interval tick
 *   (= don't create new polling request). Already in-progress requests untouched by this hook —
 *   abort/cancel is caller's responsibility.
 * - On hidden → visible transition, call callback immediately once, then restart interval from that point
 *   (prevent duplicate tick right after transition).
 * - If enabled=false (e.g., terminal state), schedule nothing.
 */
import { useEffect, useRef } from "react";

export type VisibilityPollReason = "interval" | "visible-resume";

/**
 * @param tick - Callback to execute (usually query latest state once). Safe to recreate each render.
 * @param intervalMs - Polling interval (ms).
 * @param enabled - If false, don't schedule/trigger any ticks (terminal state, etc.).
 */
export function useVisibilityAwarePolling(
  tick: (reason: VisibilityPollReason) => void,
  intervalMs: number,
  enabled: boolean,
): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") {
          tickRef.current("interval");
        }
        // If hidden, reschedule next check without request — don't create new polling request.
        scheduleNext();
      }, intervalMs);
    };

    scheduleNext();

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
     // On resume, refresh immediately once, then restart interval from that point (prevent duplicate tick right after).
      tickRef.current("visible-resume");
      scheduleNext();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
