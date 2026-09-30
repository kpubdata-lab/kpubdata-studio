/**
 * Quality results in the four meanings of #524.
 *
 * PASS is plain text; WARN and FAIL are badges with their word; N/A means nothing was
 * evaluated; a status absent from the response is `—`, never N/A.
 */
import { useTranslation } from "react-i18next";

import { ActionableStatus, MissingStatus, NormalStatus, NotEvaluatedStatus, UnknownStatus } from "@/shared/ui/StatusState";

import type { QualityState, ValidationStatus } from "./model";

export function QualityBadge({ status }: { status: ValidationStatus | undefined }) {
  switch (status) {
    case "PASS":
      return <NormalStatus className="text-xs font-semibold">PASS</NormalStatus>;
    case "WARN":
      return <ActionableStatus className="font-semibold" tone="warning">WARN</ActionableStatus>;
    case "FAIL":
      return <ActionableStatus className="font-semibold" tone="failure">FAIL</ActionableStatus>;
    case "N/A":
      return <NotEvaluatedStatus className="text-xs font-semibold" />;
    default:
      return <MissingStatus className="text-xs" />;
  }
}

/**
 * Five-state badge used by Quality Center (#254).
 *
 * `QualityBadge` (PASS/WARN/FAIL/N/A) is already validated in #253 for
 * single-source scope display, so it stays; this separate badge is for
 * screens (#254 §4) that must not collapse NOT_EVALUATED (never evaluated)
 * and UNAVAILABLE (availability=unavailable) into one N/A. NOT_EVALUATED is
 * not-evaluated; UNAVAILABLE is Builder's explicit "I cannot tell", so it takes
 * the unknown treatment with its own word.
 */
export function QualityStateBadge({ state }: { state: QualityState }) {
  const { t } = useTranslation();
  // PASS/WARN/FAIL stay as Builder vocabulary; only the descriptive label is translated.
  switch (state) {
    case "NOT_EVALUATED":
      return <NotEvaluatedStatus className="text-xs font-semibold">{t("quality.badge.notEvaluated")}</NotEvaluatedStatus>;
    case "UNAVAILABLE":
      return <UnknownStatus className="text-xs font-semibold">{t("quality.badge.unavailable")}</UnknownStatus>;
    default:
      return <QualityBadge status={state} />;
  }
}
