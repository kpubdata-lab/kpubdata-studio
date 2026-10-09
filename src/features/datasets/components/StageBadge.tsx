/**
 * One stage's status, in the four meanings of #524.
 *
 * `completed` is plain text and `failed` a badge. `unavailable` is Builder saying it has
 * no such stage to show — its explicit unknown, in muted text.
 * `not_run` is not evaluated. A status absent from the response is `—`, never
 * `unavailable`: Studio does not invent Builder's words.
 */
import { useTranslation } from "react-i18next";
import { codeLabel } from "@/shared/i18n/codeLabels";
import type { StageStatus } from "@/shared/lib/builderApi";
import { ActionableStatus, MissingStatus, NormalStatus, NotEvaluatedStatus, UnknownStatus } from "@/shared/ui/StatusState";

export function StageBadge({ status }: { status: StageStatus | undefined }) {
  const { t } = useTranslation();
  const label = status ? codeLabel(t, "stageStatus", status) : "";
  switch (status) {
    case "completed":
      return <NormalStatus className="text-xs">{label}</NormalStatus>;
    case "failed":
      return <ActionableStatus tone="failure">{label}</ActionableStatus>;
    case "unavailable":
      return <UnknownStatus className="text-xs">{label}</UnknownStatus>;
    case "not_run":
      return <NotEvaluatedStatus className="text-xs">{label}</NotEvaluatedStatus>;
    default:
      return <MissingStatus className="text-xs" />;
  }
}
