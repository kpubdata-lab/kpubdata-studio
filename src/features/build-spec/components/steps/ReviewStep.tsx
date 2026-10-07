/**
 * Wizard step 6 — validation and execution (#379).
 *
 * Run button gated by single `canRun`. Page already determined "passed validation + not running + spec exists"
 * and passes it, so component can't reassemble conditions and diverge.
 */
import { useTranslation } from "react-i18next";

import { Button, Card } from "@/shared/ui";
import { BuildKeyNotice } from "@/features/provider/BuildKeyNotice";
import type { BuildJob } from "@/features/runs/useBuildJob";
import type { ValidationState } from "@/features/build-spec/newBuildModel";

export interface ReviewStepProps {
  validation: ValidationState;
  job: BuildJob;
  canRun: boolean;
  canSave: boolean;
  saveSpecMessage: { type: "success" | "error"; text: string } | null;
  onRevalidate: () => void;
  onRun: () => void;
  onSaveSpec: () => void;
  /** Re-running an existing run's spec refreshes a table; it does not create one (#422). */
  isRefresh?: boolean;
}

export function ReviewStep({
  validation,
  job,
  canRun,
  canSave,
  saveSpecMessage,
  onRevalidate,
  onRun,
  onSaveSpec,
  isRefresh = false,
}: ReviewStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold tracking-tight">{t("newBuild.review.title")}</h3>
        <Button
          variant="secondary"
          size="sm"
          loading={validation.status === "validating"}
          onClick={onRevalidate}
        >
          {t("newBuild.review.revalidate")}
        </Button>
      </div>
      {validation.status === "idle" ? (
        <p className="text-sm text-muted-foreground">{t("newBuild.review.guide")}</p>
      ) : null}
      {validation.status === "validated" && validation.isValid ? (
        <Card variant="success" className="p-4">
          <p className="text-sm font-medium text-brand-text">{t("newBuild.review.passed")}</p>
        </Card>
      ) : null}
      {validation.errors.length > 0 ? (
        <ul className="space-y-2">
          {validation.errors.map((error) => (
            <li
              key={error}
              role="alert"
              className="rounded-2xl bg-status-failure-subtle px-3 py-2 text-sm text-status-failure"
            >
              {error}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!canRun} loading={job.status === "running"} onClick={onRun}>
          {t(isRefresh ? "newBuild.review.runRefresh" : "newBuild.review.run")}
        </Button>
        {job.status === "running" ? (
          <Button variant="secondary" onClick={job.cancel}>
            {t("newBuild.review.cancel")}
          </Button>
        ) : null}
        {job.status === "succeeded" ? (
          <span className="text-sm text-brand-text">
            {t("newBuild.review.success", { id: job.run?.id })}
          </span>
        ) : null}
        {job.status === "failed" ? (
          <span role="alert" className="text-sm text-status-failure">
            {job.error}
          </span>
        ) : null}
        {job.status === "cancelled" ? (
          <span className="text-sm text-muted-foreground">{t("newBuild.review.cancelled")}</span>
        ) : null}
      </div>
      <BuildKeyNotice job={job} />

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button variant="secondary" disabled={!canSave} onClick={onSaveSpec}>
          {t("newBuild.review.saveSpec")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("newBuild.review.saveSpecDesc")}</span>
      </div>
      {saveSpecMessage ? (
        <p
          role={saveSpecMessage.type === "error" ? "alert" : undefined}
          className={`text-sm ${saveSpecMessage.type === "error" ? "text-status-failure" : "text-brand-text"}`}
        >
          {saveSpecMessage.text}
        </p>
      ) : null}
    </div>
  );
}
