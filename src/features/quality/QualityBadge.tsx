import { useTranslation } from "react-i18next";
import type { QualityState, ValidationStatus } from "./model";

const STATUS_CLASS: Record<ValidationStatus, string> = {
  PASS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  WARN: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  FAIL: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  "N/A": "bg-muted text-muted-foreground",
};

export function QualityBadge({ status }: { status: ValidationStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`}>
      {status}
    </span>
  );
}

/**
 * Five-state badge used by Quality Center (#254).
 *
 * `QualityBadge` (PASS/WARN/FAIL/N/A) is already validated in #253 for
 * single-source scope display, so it stays; this separate badge is for
 * screens (#254 §4) that must not collapse NOT_EVALUATED (never evaluated)
 * and UNAVAILABLE (availability=unavailable) into one N/A. Distinguished by
 * wording as well as color.
 */
const STATE_CLASS: Record<QualityState, string> = {
  FAIL: STATUS_CLASS.FAIL,
  WARN: STATUS_CLASS.WARN,
  PASS: STATUS_CLASS.PASS,
  NOT_EVALUATED: "bg-muted text-muted-foreground",
  UNAVAILABLE: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const STATE_LABEL: Record<QualityState, string> = {
  FAIL: "FAIL",
  WARN: "WARN",
  PASS: "PASS",
  NOT_EVALUATED: "quality.badge.notEvaluated",
  UNAVAILABLE: "quality.badge.unavailable",
};

export function QualityStateBadge({ state }: { state: QualityState }) {
  const { t } = useTranslation();
  // PASS/WARN/FAIL stay as Builder vocabulary; only the descriptive label is translated.
  const label = STATE_LABEL[state].startsWith("quality.badge.") ? t(STATE_LABEL[state]) : STATE_LABEL[state];
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_CLASS[state]}`}>
      {label}
    </span>
  );
}
