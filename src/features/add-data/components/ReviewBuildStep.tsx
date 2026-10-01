/**
 * Create table step 3 — Create (review and build) (#250, #534).
 *
 * The displayed "actual canonical BuildSpec to be submitted" is the pretty-printed result of toBuilderSpec(spec) —
 * same toBuilderSpec call result as serializeSpec (compact JSON) used for build submission, so displayed and
 * submitted values never diverge (#250 amendment 1). Block build if preview is stale (spec/options changed since last preview).
 *
 * The logical name each source's table will get (`<dataset_id>.<source_key>`, #534) is built from the
 * `source_key` Builder's preview returned — Studio does not derive source keys itself. Before a fresh
 * preview there is no name to show, and the step says so.
 *
 * Two exceptions (#283 review response, Epic #246, follow-up §1): url source endpoint and public_api source sourceParams
 * may contain secret query/param values (api_key/serviceKey/token/secret, high-entropy), so redactBuildSpecForDisplay/
 * redactSourceParamsText create separate display copies — actual build submission (AddDataPage onBuild → job.start(specResult.spec))
 * bypasses this component and uses the original spec, so display redaction does not affect submitted values.
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";
import { toBuilderSpec } from "@/features/build-spec/specMapping";
import { previewSourceStateLabel, summarizeChecksPassed, summarizePreviewSources } from "@/features/quality/model";
import { QualityBadge } from "@/features/quality/QualityBadge";
import { redactBuildSpecForDisplay } from "@/features/add-data/model";
import { redactUrlEndpoint } from "@/features/add-data/urlRedaction";
import { redactSourceParamsText } from "@/features/add-data/paramsRedaction";
import type { PreviewSource } from "@/shared/lib/builderApi";
import type { BuildJobStatus } from "@/features/runs/useBuildJob";
import type { AddDataDraft, PreviewLimit, PreviewSampleMode } from "@/features/add-data/model";
import type { BuildSpec } from "@/shared/lib/types";
import { Button, Card } from "@/shared/ui";

export interface ReviewBuildStepProps {
  draft: AddDataDraft;
  spec?: BuildSpec;
  specError?: string;
  validation: { status: "idle" | "validating" | "validated"; valid: boolean; errors: string[] };
  /** All sources returned by Builder /preview (#250 §3) — do not use only the first item. */
  previewSources: PreviewSource[];
  previewLimit: PreviewLimit;
  previewSampleMode: PreviewSampleMode;
  isStale: boolean;
  jobStatus: BuildJobStatus;
  jobError?: string;
  /** User interrupted an in-flight request on the client (server execution result unknown, sync build). */
  jobInterrupted?: boolean;
  runId?: string;
  onBuild: () => void;
  onCancel: () => void;
}

// Display-only — sourceSummary/querySummary are Review summaries for human reading, not actual Builder submission values,
// so use redacted endpoint without secret query parameters (#283 review response, Epic #246). Actual submission bypasses these functions.
function sourceSummary(draft: AddDataDraft): string {
  if (draft.sourceKind === "public_api") return `Public API · ${draft.publicApi.provider}/${draft.publicApi.dataset}`;
  if (draft.sourceKind === "file") return `File Upload · ${draft.file.filename ?? draft.file.format ?? ""}`;
  if (draft.sourceKind === "url") return `URL / REST API · ${redactUrlEndpoint(draft.url.endpoint).endpoint}`;
  return i18n.t("addData.review.notSelected");
}

function querySummary(draft: AddDataDraft): string {
  if (draft.sourceKind === "public_api") return redactSourceParamsText(draft.publicApi.sourceParams).text;
  if (draft.sourceKind === "file") return `${draft.file.format ?? "—"} · ${draft.file.encoding}`;
  if (draft.sourceKind === "url") return redactUrlEndpoint(draft.url.endpoint).endpoint || "—";
  return "—";
}

const PIPELINE_STAGES = ["Bronze", "Validate", "Silver", "Gold"] as const;

/**
 * Pipeline stage-flow display state (same principle as Prototype reviewBuild() stage-flow).
 * Studio does not receive stage-level progress from useBuildJob, so reflect only what is known (overall build job status) —
 * do not fabricate fake granular progress.
 */
function pipelineStageStatus(jobStatus: BuildJobStatus): string {
  if (jobStatus === "succeeded") return i18n.t("labels.done");
  if (jobStatus === "failed") return i18n.t("addData.review.stageAborted");
  if (jobStatus === "running") return i18n.t("addData.review.stageRunning");
  return i18n.t("labels.pending");
}

export function ReviewBuildStep({
  draft,
  spec,
  specError,
  validation,
  previewSources,
  previewLimit,
  previewSampleMode,
  isStale,
  jobStatus,
  jobError,
  jobInterrupted,
  runId,
  onBuild,
  onCancel,
}: ReviewBuildStepProps) {
  // Actual submission always uses the original spec (AddDataPage onBuild passes specResult.spec to job.start directly) —
  // displaySpec here is a display-only copy, and redaction has no effect on actual submission (#283 review response, Epic #246).
  const { t } = useTranslation();
  const logicalNameId = useId();
  const logicalNames = spec && !isStale ? previewSources.map((source) => `${spec.datasetId}.${source.source_key}`) : [];
  const displaySpec = spec ? redactBuildSpecForDisplay(spec) : null;
  const displaySubmissionSpec = displaySpec ? toBuilderSpec(displaySpec) : null;
   // Do not fabricate fake single PASS from multiple sources' quality_results — sum results as Builder actually returned
   // (pass/warn/fail counts), and if per-source status varies, display as mixed (#250 §3).
  const totalRows = previewSources.length > 0 ? previewSources[0].total_rows : undefined;
  const previewsSummary = summarizePreviewSources(previewSources);
  const quality = previewSources.length > 0
    ? summarizeChecksPassed(previewSources.flatMap((s) => s.quality_results))
    : null;
  const canBuild =
    Boolean(spec) &&
    validation.status === "validated" &&
    validation.valid &&
    !isStale &&
    jobStatus !== "running";

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold tracking-tight">{t("addData.review.title")}</h3>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">{t("addData.review.datasetLabel")}</p>
          <p className="mt-1 text-base font-semibold">{draft.title || draft.datasetId || "—"}</p>
          <p className="text-xs text-muted-foreground">{sourceSummary(draft)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">{t("addData.review.previewLabel")}</p>
          <p className="mt-1 text-base font-semibold">{t("labels.rows", { count: previewLimit })} · {previewSampleMode}</p>
          <p className="text-xs text-muted-foreground">
            {previewSources.length > 0
              ? previewSources.length > 1
                ? t("addData.review.previewMulti", {
                    count: previewSources.length,
                    mixed: previewsSummary.mixed ? " · mixed" : "",
                  })
                : t("addData.review.previewSingle", { total: totalRows })
              : t("addData.review.notRun")}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">{t("addData.review.validationLabel")}</p>
          <p className="mt-1 text-base font-semibold">
            {validation.status !== "validated"
              ? t("addData.review.notRun")
              : validation.valid
                ? t("addData.review.passed")
                : t("addData.review.failedLabel")}
          </p>
          {quality ? <QualityBadge status={quality.status} /> : <p className="text-xs text-muted-foreground">{t("addData.review.noQuality")}</p>}
          {previewsSummary.mixed ? (
            <p role="status" className="mt-1 text-xs text-status-warning">
              {t("addData.review.mixedShort")}
            </p>
          ) : null}
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">{t("addData.review.outputLabel")}</p>
          <p className="mt-1 text-base font-semibold">{draft.exportFormats.join(", ").toUpperCase() || "—"}</p>
          <p className="text-xs text-muted-foreground">Bronze → Silver → Gold</p>
        </Card>
      </div>

      <Card aria-labelledby={logicalNameId} className="p-4" role="group">
        <p className="text-xs font-semibold uppercase text-muted-foreground" id={logicalNameId}>
          {t("addData.review.logicalNameLabel")}
        </p>
        {logicalNames.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {logicalNames.map((name) => (
              <li className="break-all font-mono text-sm" key={name}>{name}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t("addData.review.logicalNameAfterPreview")}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{t("addData.review.logicalNameNote")}</p>
      </Card>

      {isStale ? (
        <Card variant="error" className="p-4">
          <p role="alert" className="text-sm text-status-failure">
            {t("addData.review.staleWarning")}
          </p>
        </Card>
      ) : null}

      {!validation.valid && validation.status === "validated" ? (
        <Card variant="error" className="p-4">
          <ul className="space-y-1 text-sm text-status-failure">
            {validation.errors.map((err, i) => (
              <li key={i} role="alert">{err}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {specError ? (
        <p role="alert" className="text-sm text-status-failure">{specError}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <p className="text-sm font-semibold">{t("addData.review.planTitle")}</p>
          <dl className="divide-y divide-border text-sm">
            {[
              [t("addData.review.planSource"), sourceSummary(draft)],
              [t("addData.review.planDataset"), draft.title || draft.datasetId || "—"],
              [t("addData.review.planQuery"), querySummary(draft)],
              [
                t("addData.review.planPreview"),
                previewSources.length > 0
                  ? previewSources.length > 1
                    ? t("addData.review.planPreviewMulti", {
                        limit: previewLimit,
                        mode: previewSampleMode,
                        count: previewSources.length,
                        mixed: previewsSummary.mixed ? " (mixed)" : "",
                      })
                    : t("addData.review.planPreviewSingle", {
                        limit: previewLimit,
                        mode: previewSampleMode,
                        total: totalRows,
                      })
                  : t("addData.review.notRun"),
              ],
              ["Validation", quality ? `${quality.pass}/${quality.evaluated} · ${quality.status}` : t("addData.review.notRun")],
              ["Output", draft.exportFormats.join(", ").toUpperCase() || "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 py-2">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </dl>
          {previewSources.length > 1 ? (
            <div className="space-y-1.5 border-t border-border pt-3">
              <p className="text-sm font-semibold">{t("addData.review.perSourceTitle")}</p>
              {previewsSummary.perSource.map(({ source: s, state, quality: q }) => (
                <div key={s.source_key} className="flex items-center justify-between text-sm">
                  <span>{s.source_key}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {previewSourceStateLabel(state)}
                    {q.evaluated > 0 ? <QualityBadge status={q.status} /> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="border-t border-border pt-3">
            <p className="text-sm font-semibold">{t("labels.pipeline")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-muted-foreground">{t("labels.source")}</p>
                <p className="font-semibold">{jobStatus === "succeeded" ? t("labels.done") : t("labels.ready")}</p>
              </div>
              {PIPELINE_STAGES.map((stage) => (
                <span key={stage} className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-muted-foreground">→</span>
                  <span className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block text-muted-foreground">{stage}</span>
                    <span className="block font-semibold">{pipelineStageStatus(jobStatus)}</span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card className="space-y-2">
          <p className="text-sm font-semibold">{t("addData.review.specTitle")}</p>
          <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs leading-6 text-zinc-100">
            <code>
              {displaySubmissionSpec
                ? JSON.stringify(displaySubmissionSpec, null, 2)
                : t("addData.review.specUnavailable")}
            </code>
          </pre>
          <p className="text-xs text-muted-foreground">
            {t("addData.review.specNote")}
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!canBuild} loading={jobStatus === "running"} onClick={onBuild}>
          {t("addData.review.startBuild")}
        </Button>
        {jobStatus === "running" ? (
          <Button variant="secondary" onClick={onCancel}>{t("addData.review.cancel")}</Button>
        ) : null}
        {jobStatus === "succeeded" && runId ? (
          <span className="text-sm text-brand-text">{t("addData.review.buildSucceeded", { runId })}</span>
        ) : null}
        {jobStatus === "failed" ? (
          <span role="alert" className="text-sm text-status-failure">{jobError}</span>
        ) : null}
        {jobStatus === "cancelled" ? (
          <span className="text-sm text-muted-foreground">{t("addData.review.buildCancelled")}</span>
        ) : null}
        {jobInterrupted && jobStatus !== "cancelled" ? (
          <span className="text-sm text-muted-foreground">{t("addData.review.interrupted")}</span>
        ) : null}
      </div>
    </div>
  );
}
