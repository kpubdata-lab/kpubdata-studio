/**
 * One stage's status, in the four meanings of #524.
 *
 * `completed` is plain text and `failed` a badge. `unavailable` is Builder saying it has
 * no such stage to show — its explicit unknown, in muted text with Builder's word.
 * `not_run` is not evaluated. A status absent from the response is `—`, never
 * `unavailable`: Studio does not invent Builder's words.
 */
import type { StageStatus } from "@/shared/lib/builderApi";
import { ActionableStatus, MissingStatus, NormalStatus, NotEvaluatedStatus, UnknownStatus } from "@/shared/ui/StatusState";

export function StageBadge({ status }: { status: StageStatus | undefined }) {
  switch (status) {
    case "completed":
      return <NormalStatus className="text-xs">{status}</NormalStatus>;
    case "failed":
      return <ActionableStatus tone="failure">{status}</ActionableStatus>;
    case "unavailable":
      return <UnknownStatus className="text-xs">{status}</UnknownStatus>;
    case "not_run":
      return <NotEvaluatedStatus className="text-xs">{status}</NotEvaluatedStatus>;
    default:
      return <MissingStatus className="text-xs" />;
  }
}
