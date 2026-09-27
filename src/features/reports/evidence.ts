/**
 * Report reference Builder evidence lookup (#258).
 *
 * Follows same pattern as `features/kubi/evidence.ts`(#256) — calls multiple Builder endpoints
 * in parallel/sequence; if one fails, rest proceed ("partial failure allowed", #258 §5). No new
 * Builder endpoint created; reuses `features/datasets/api` (#256/#253/#254 already vetted client).
 *
 * Output (artifacts) evidence fetched only in real-run mode — `getBuildManifest` in mock mode
 * falls back to separate demo catalog (`shared/lib/demoDatasets.ts`) independent of run_id, so
 * using it raw shows artifact list for other dataset/run as evidence (#258 §4 — never invent
 * missing data).
 */
import { i18n } from "@/shared/i18n";
import {
  getBuildQuality,
  getBuildStageDetail,
  getDataset,
  listBuildStages,
  listDatasetRuns,
} from "@/features/datasets/api";
import { getBuildManifest } from "@/features/artifacts/api";
import { isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type {
  BuildQualityResponse,
  DatasetDetailResponse,
  DatasetRunSummary,
  RunStagesResponse,
  StageDetailResponse,
} from "@/shared/lib/builderApi";
import type { ReportEvidenceRef } from "./types";

/** silver StageDetailResponse schema array element type (no separate export type; extracted from discriminated union). */
type SilverColumnInfo = Extract<StageDetailResponse, { stage: "silver" }>["schema"][number];

type Settled<T> = { ok: true; value: T } | { ok: false; reason: string };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : i18n.t("reports.evidence.lookupFailed") };
  }
}

export interface ReportSourceSchema {
  sourceKey: string;
  /** "silver" if silver schema fully obtained; "gold_names_only" if only gold column names; else "unavailable" */
  origin: "silver" | "gold_names_only" | "unavailable";
  columns: SilverColumnInfo[];
  /** Column names without dtype info; populated only for gold_names_only */
  columnNamesOnly?: string[];
  reason?: string;
}

export interface ReportOutputEvidence {
  files: string[];
}

export interface ReportEvidenceBundle {
  fetchedAt: string;
  datasetId: string;
  runId: string;
  dataset: Settled<DatasetDetailResponse>;
  /** Match from listDatasetRuns response where runId matches (spec_digest/timestamp etc).
   * If run itself deleted/inaccessible, mark as failed. */
  run: Settled<DatasetRunSummary>;
  stages: Settled<RunStagesResponse>;
  quality: Settled<BuildQualityResponse>;
  schemas: Record<string, ReportSourceSchema>;
  output: Settled<ReportOutputEvidence>;
}

async function fetchSourceSchema(runId: string, sourceKey: string, signal?: AbortSignal): Promise<ReportSourceSchema> {
  const silver = await settle(getBuildStageDetail(runId, "silver", sourceKey, 1, signal));
  if (silver.ok && silver.value.stage === "silver" && silver.value.available && silver.value.schema.length > 0) {
    return { sourceKey, origin: "silver", columns: silver.value.schema };
  }

  const gold = await settle(getBuildStageDetail(runId, "gold", sourceKey, 1, signal));
  if (gold.ok && gold.value.stage === "gold" && gold.value.available && gold.value.columns.length > 0) {
    return { sourceKey, origin: "gold_names_only", columns: [], columnNamesOnly: gold.value.columns };
  }

  const reason = !silver.ok && !gold.ok
    ? i18n.t("reports.evidence.schemaBothFailed")
    : i18n.t("reports.evidence.schemaNotReached");
  return { sourceKey, origin: "unavailable", columns: [], reason };
}

/**
 * Gather evidence for reference dataset/run all at once.
 *
 * @param datasetId - Report's reference dataset.
 * @param runId - Report's fixed reference run (baseRunId). Not auto-replaced with latest run.
 * @param signal - Abort signal.
 */
export async function fetchReportEvidence(
  datasetId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<ReportEvidenceBundle> {
  const [datasetResult, runsResult, stagesResult, qualityResult] = await Promise.all([
    settle(getDataset(datasetId, signal)),
    settle(listDatasetRuns(datasetId, 50, signal)),
    settle(listBuildStages(runId, signal)),
    settle(getBuildQuality(runId, signal)),
  ]);

  const runResult: Settled<DatasetRunSummary> = runsResult.ok
    ? (() => {
        const match = runsResult.value.runs.find((run) => run.run_id === runId);
        return match ? { ok: true, value: match } : { ok: false, reason: i18n.t("reports.evidence.baseRunMissing") };
      })()
    : { ok: false, reason: runsResult.reason };

  const sourceKeys = stagesResult.ok
    ? stagesResult.value.sources.map((s) => s.source_key)
    : datasetResult.ok
      ? Object.keys(datasetResult.value.stages)
      : [];

  const schemaEntries = await Promise.all(
    sourceKeys.map(async (sourceKey) => [sourceKey, await fetchSourceSchema(runId, sourceKey, signal)] as const),
  );
  const schemas: Record<string, ReportSourceSchema> = Object.fromEntries(schemaEntries);

  const output: Settled<ReportOutputEvidence> = isRealBuilderEnabled()
    ? await settle(getBuildManifest(runId, signal).then((manifest) => ({ files: manifest.outputs ?? [] })))
    : { ok: false, reason: i18n.t("reports.evidence.mockNoOutput") };

  return {
    fetchedAt: new Date().toISOString(),
    datasetId,
    runId,
    dataset: datasetResult,
    run: runResult,
    stages: stagesResult,
    quality: qualityResult,
    schemas,
    output,
  };
}

/** From evidence bundle, build stable reference list from actually verified pieces (omit unverified). */
export function buildEvidenceRefs(evidence: ReportEvidenceBundle): ReportEvidenceRef[] {
  const refs: ReportEvidenceRef[] = [];
  if (evidence.dataset.ok) {
    refs.push({ kind: "dataset", id: evidence.datasetId, label: evidence.dataset.value.title });
  }
  if (evidence.run.ok) {
    refs.push({ kind: "run", id: evidence.runId, label: `Run ${evidence.runId}` });
  }
  if (evidence.quality.ok) {
    refs.push({ kind: "quality", id: evidence.runId, label: "Quality" });
  }
  for (const [sourceKey, schema] of Object.entries(evidence.schemas)) {
    if (schema.origin !== "unavailable") refs.push({ kind: "schema", id: sourceKey, label: `Schema · ${sourceKey}` });
  }
  if (evidence.stages.ok) {
    for (const source of evidence.stages.value.sources) {
      refs.push({ kind: "stage", id: source.source_key, label: `Stage · ${source.source_key}` });
    }
  }
  if (evidence.output.ok) {
    refs.push({ kind: "output", id: evidence.runId, label: "Output" });
  }
  return refs;
}
