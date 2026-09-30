/**
 * A table's five status axes, one entry each (#422), in four distinct meanings (#524).
 *
 * kpubdata's TERMINOLOGY keeps Health, Completeness, Refresh, Access and Maturity apart:
 * merged into one badge, a person has to ask "why this state?".
 *
 * Most tables are healthy, so a healthy value is plain text — colour is kept for what
 * needs action, and that badge names its axis and its word (warning, partial and stale
 * share amber, so the colour never carries the meaning alone). Builder's explicit
 * `unknown` is the word "Unknown", because not knowing is not "fine"; an axis Builder did
 * not send at all is `—` with the reason. Maturity is a grade, not a condition, so it is
 * never a badge.
 */
import { useTranslation } from "react-i18next";

import type { DatasetStatusAxes } from "@/shared/lib/builderApi.schema";
import { cn } from "@/shared/ui/cn";
import { ActionableStatus, MissingStatus, NormalStatus, UnknownStatus, type ActionTone } from "@/shared/ui/StatusState";

const AXES = ["health", "completeness", "refresh", "access", "maturity"] as const;
type Axis = (typeof AXES)[number];

export type AxisKind = { kind: "normal" } | { kind: "actionable"; tone: ActionTone } | { kind: "unknown" } | { kind: "missing" };

/** Values that need no action. Queued and running are progress, not a problem. */
const NORMAL = new Set(["healthy", "complete", "succeeded", "available", "queued", "running"]);
const FAILURE = new Set(["failed", "retired"]);

/** How one axis value is shown. Exported for the test. */
export function kindOf(axis: Axis, value: string | undefined): AxisKind {
  if (value === undefined) return { kind: "missing" };
  if (value === "unknown") return { kind: "unknown" };
  if (axis === "maturity" || NORMAL.has(value)) return { kind: "normal" };
  return { kind: "actionable", tone: FAILURE.has(value) ? "failure" : "warning" };
}

export function StatusAxes({ axes, className }: { axes: Partial<DatasetStatusAxes> | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!axes) {
    return (
      <p className={cn("text-[11px]", className)}>
        <MissingStatus label={t("statusState.axesMissing")} />
      </p>
    );
  }
  return (
    <ul aria-label={t("statusAxes.label")} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]", className)}>
      {AXES.map((axis) => {
        const value = axes[axis];
        const axisLabel = t(`statusAxes.axis.${axis}`);
        const shown = kindOf(axis, value);
        if (shown.kind === "actionable") {
          return (
            <li className="inline-flex" data-axis={axis} key={axis}>
              <ActionableStatus axis={axisLabel} className="px-1.5 py-0 text-[11px]" tone={shown.tone}>
                {t(`statusAxes.value.${axis}.${value}`)}
              </ActionableStatus>
            </li>
          );
        }
        return (
          <li className="inline-flex items-center gap-1" data-axis={axis} key={axis}>
            <span className="text-muted-foreground">{axisLabel}</span>
            {shown.kind === "normal" ? <NormalStatus>{t(`statusAxes.value.${axis}.${value}`)}</NormalStatus> : null}
            {shown.kind === "unknown" ? <UnknownStatus /> : null}
            {shown.kind === "missing" ? <MissingStatus /> : null}
          </li>
        );
      })}
    </ul>
  );
}
