/**
 * A table's five status axes, one badge each (#422).
 *
 * kpubdata's TERMINOLOGY keeps Health, Completeness, Refresh, Access and Maturity apart:
 * merged into one badge, a person has to ask "why this state?". Each badge names its
 * axis and its word, so the colour never carries the meaning alone — warning, partial
 * and stale share amber. `unknown` is shown, in neutral, because not knowing is not
 * "fine". Maturity is a grade, not a condition, so it is always neutral.
 */
import { useTranslation } from "react-i18next";

import type { DatasetStatusAxes } from "@/shared/lib/builderApi.schema";
import { cn } from "@/shared/ui/cn";

type Tone = "success" | "warning" | "failure" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-status-success-subtle text-status-success",
  warning: "bg-status-warning-subtle text-status-warning",
  failure: "bg-status-failure-subtle text-status-failure",
  neutral: "bg-muted text-muted-foreground",
};

const AXES = ["health", "completeness", "refresh", "access", "maturity"] as const;
type Axis = (typeof AXES)[number];

const SUCCESS = new Set(["healthy", "complete", "succeeded", "available"]);
const FAILURE = new Set(["failed", "retired"]);

/** The tone of one axis value. Exported for the test. */
export function toneOf(axis: Axis, value: string): Tone {
  if (axis === "maturity" || value === "unknown" || value === "cancelled") return "neutral";
  if (SUCCESS.has(value)) return "success";
  if (FAILURE.has(value)) return "failure";
  return "warning";
}

export function StatusAxes({ axes, className }: { axes: DatasetStatusAxes | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!axes) return null;
  return (
    <ul aria-label={t("statusAxes.label")} className={cn("flex flex-wrap gap-1", className)}>
      {AXES.map((axis) => {
        const value = axes[axis];
        return (
          <li
            className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[toneOf(axis, value)])}
            data-axis={axis}
            key={axis}
          >
            <span className="opacity-70">{t(`statusAxes.axis.${axis}`)}</span>
            <span>{t(`statusAxes.value.${axis}.${value}`)}</span>
          </li>
        );
      })}
    </ul>
  );
}
