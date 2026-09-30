/**
 * Public DEMO/DEV environment badge.
 *
 * Shows mock/demo environment without real account auth as a single eye-catching badge
 * instead of repeated guidance text. Conditionally rendered only from callsites that
 * check `isRealBuilderEnabled()` (real Builder integration status) — this component
 * itself always means "DEMO".
 */
import { cn } from "./cn";

export interface DemoBadgeProps {
  className?: string;
}

export function DemoBadge({ className }: DemoBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-status-warning-subtle px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-status-warning",
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      DEMO
    </span>
  );
}
