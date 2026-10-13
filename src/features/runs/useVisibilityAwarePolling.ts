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
 * - One tick at a time (#979): the interval is counted from the moment a tick settles, not from the
 *   moment it starts. A tick that returns a promise holds the next one back until that promise
 *   settles, so an answer slower than the interval is waited for rather than raced by a second
 *   request. A return to the visible tab while a tick is still out starts no second one — the
 *   answer on its way is already the refresh.
 */
import { useEffect, useRef } from "react";

export type VisibilityPollReason = "interval" | "visible-resume";

/**
 * @param tick - Callback to execute (usually query latest state once). Return the promise of the
 *   request it starts so that the next tick waits for it. Safe to recreate each render.
 * @param intervalMs - Pause between one tick settling and the next one starting (ms).
 * @param enabled - If false, don't schedule/trigger any ticks (terminal state, etc.).
 */
export function useVisibilityAwarePolling(
  tick: (reason: VisibilityPollReason) => void | Promise<void>,
  intervalMs: number,
  enabled: boolean,
): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let stopped = false;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const scheduleNext = () => {
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (document.visibilityState === "visible") {
          run("interval");
          return;
        }
        // If hidden, reschedule next check without request — don't create new polling request.
        scheduleNext();
      }, intervalMs);
    };

    const run = (reason: VisibilityPollReason) => {
      running = true;
      const settled = () => {
        running = false;
        if (!stopped) scheduleNext();
      };
      let pending: void | Promise<void>;
      try {
        pending = tickRef.current(reason);
      } catch (cause) {
        settled();
        throw cause;
      }
      // A tick that starts no request has nothing to wait for. A tick that fails is still a
      // settled tick: the next one is what recovers from it.
      if (pending) void pending.then(settled, settled);
      else settled();
    };

    scheduleNext();

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // The tick still out answers for this return; its settling schedules the next one.
      if (running) return;
      // On resume, refresh immediately once, then restart interval from that point (prevent duplicate tick right after).
      clearTimer();
      run("visible-resume");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
