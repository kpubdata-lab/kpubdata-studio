/**
 * Common StatusBadge component.
 *
 * Display all status values in draft/run/publish flow with Korean label and consistent
 * color. Always show text label together with color to avoid relying on color alone for
 * meaning (accessibility).
 */
import { cn } from "./cn";
import { useTranslation } from "react-i18next";

/** union of all status values displayable as badge across Studio */
export type StatusValue =
  | "new"
  | "draft"
  | "dirty"
  | "validated"
  | "invalid"
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "publishing"
  | "published";

interface StatusMeta {
  /** label i18n key (`status.*`). Hardcoding text in constant doesn't reflect language switch(#350). */
  labelKey: string;
  /** Tailwind color class */
  className: string;
}

const STATUS_META: Record<StatusValue, StatusMeta> = {
  new: { labelKey: "new", className: "bg-muted text-muted-foreground" },
  draft: { labelKey: "draft", className: "bg-muted text-muted-foreground" },
  dirty: { labelKey: "dirty", className: "bg-status-warning-subtle text-status-warning" },
  validated: { labelKey: "validated", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" },
  invalid: { labelKey: "invalid", className: "bg-status-failure-subtle text-status-failure" },
  queued: { labelKey: "queued", className: "bg-muted text-muted-foreground" },
  running: { labelKey: "running", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" },
  cancelling: { labelKey: "cancelling", className: "bg-status-warning-subtle text-status-warning" },
  succeeded: { labelKey: "succeeded", className: "bg-status-success-subtle text-status-success" },
  failed: { labelKey: "failed", className: "bg-status-failure-subtle text-status-failure" },
  cancelled: { labelKey: "cancelled", className: "bg-muted text-muted-foreground" },
  publishing: { labelKey: "publishing", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" },
  published: { labelKey: "published", className: "bg-status-success-subtle text-status-success" },
};

/** neutral badge style for unknown status values */
const FALLBACK_META: StatusMeta = {
  labelKey: "",
  className: "bg-muted text-muted-foreground",
};

export interface StatusBadgeProps {
   /**
    * Status value to display.
    *
    * If known `StatusValue`, use its label/color; otherwise display arbitrary string
    * as neutral badge (prevents crash if mapping missing).
    */
  status: StatusValue | (string & {});
  /** additional className */
  className?: string;
}

/**
 * Render badge with label (in current language) and color for status value.
 *
 * Unknown status value falls back to neutral badge with original string as label.
 *
 * @param props - status and additional className.
 * @returns Status badge element.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useTranslation();
  const known = STATUS_META[status as StatusValue] as StatusMeta | undefined;
  const meta = known ?? FALLBACK_META;
  // show unknown status as-is without translation (prevents crash on missing mapping).
  const label = known ? t(`status.${known.labelKey}`) : status;
  const isLive = status === "running" || status === "publishing" || status === "cancelling";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        meta.className,
        className,
      )}
    >
      {isLive ? (
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {label}
    </span>
  );
}
