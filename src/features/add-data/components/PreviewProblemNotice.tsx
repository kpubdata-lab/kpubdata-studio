/**
 * Why the review step will not build yet, and the way back to the preview (#842).
 * See `previewGate.ts`.
 */
import { useTranslation } from "react-i18next";

import type { PreviewProblem } from "@/features/add-data/previewGate";
import { Button, Card } from "@/shared/ui";

export interface PreviewProblemNoticeProps {
  problem: PreviewProblem | null;
  onBackToPreview: () => void;
}

export function PreviewProblemNotice({ problem, onBackToPreview }: PreviewProblemNoticeProps) {
  const { t } = useTranslation();
  if (problem === null) return null;

  return (
    <Card className="space-y-3 p-4" data-preview-problem={problem.kind} variant="error">
      <div className="space-y-1" role="alert">
        <p className="text-sm font-semibold">{t("addData.review.previewGateTitle")}</p>
        {problem.kind === "not_run" ? (
          <p className="text-sm">{t("addData.review.previewGateNotRun")}</p>
        ) : problem.kind === "request_failed" ? (
          <>
            <p className="break-words text-sm text-status-failure">{problem.error}</p>
            <p className="text-sm">{t("addData.review.previewGateSameReason")}</p>
          </>
        ) : (
          <>
            <ul className="space-y-0.5 text-sm text-status-failure">
              {problem.sources.map((source) => (
                <li className="break-words" key={source.sourceKey}>
                  <span className="font-mono">{source.sourceKey}</span>
                  {": "}
                  {source.error ?? t("addData.preview.unknownError")}
                </li>
              ))}
            </ul>
            <p className="text-sm">{t("addData.review.previewGateSameReason")}</p>
          </>
        )}
      </div>
      <Button onClick={onBackToPreview} variant="secondary">{t("addData.review.previewGateBack")}</Button>
    </Card>
  );
}
