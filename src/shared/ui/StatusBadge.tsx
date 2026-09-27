/**
 * common StatusBadge component.
 *
 * display all status values in draft/run/publish flow with Korean label + consistent color다.
 * 색상만으로 의미를 전달하지 않도록 항상 텍스트 라벨을 함께 노출한다(접근성).
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
  dirty: { labelKey: "dirty", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  validated: { labelKey: "validated", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" },
  invalid: { labelKey: "invalid", className: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300" },
  queued: { labelKey: "queued", className: "bg-muted text-muted-foreground" },
  running: { labelKey: "running", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" },
  cancelling: { labelKey: "cancelling", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  succeeded: { labelKey: "succeeded", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
  failed: { labelKey: "failed", className: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300" },
  cancelled: { labelKey: "cancelled", className: "bg-muted text-muted-foreground" },
  publishing: { labelKey: "publishing", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" },
  published: { labelKey: "published", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
};

/** neutral badge style for unknown status values */
const FALLBACK_META: StatusMeta = {
  labelKey: "",
  className: "bg-muted text-muted-foreground",
};

export interface StatusBadgeProps {
  /**
   * status value to display.
   *
   * if known `StatusValue`, use its label/color; else arbitrary string gets neutral label
   * 중립 배지로 안전하게 표시한다(매핑 누락 시 크래시 방지).
   */
  status: StatusValue | (string & {});
  /** additional className */
  className?: string;
}

/**
 * render badge with label (in current language) and color for status value.
 *
 * unknown status value uses original string as label with neutral badge지로 폴백한다.
 *
 * @param props - status와 additional className.
 * @returns 상태 배지 엘리먼트.
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
