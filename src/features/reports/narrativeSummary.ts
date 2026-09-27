/**
 * Report narrative summary generation (#258 IA redesign — not table-only view but readable
 * report body shown first).
 *
 * Detail table from `deterministicSections.ts` (BuilderEvidenceBlock.markdown) kept; only prepend
 * narrative summary here. Values from `ReportEvidenceBundle` (raw from Builder) only; LLM not
 * involved — never invent row count/PASS·WARN·FAIL/schema/pipeline status/actual·expected values
 * (#258 §4 same invariant). Unverified values written "cannot verify", not papered over as 0/PASS.
 */
import {
  flattenQualityResults,
  flattenSchemaDrift,
  formatQualityValue,
  isDuplicateCategory,
  isMissingCategory,
  isSchemaCategory,
} from "@/features/quality/model";
import { i18n } from "@/shared/i18n";
import type { QualityCheckResult, SchemaDriftFinding, StageStatus } from "@/shared/lib/builderApi";
import type { ReportEvidenceBundle, ReportSourceSchema } from "./evidence";
import type { BuilderEvidenceSection } from "./types";

/** All sentence keys in this file live under this namespace (#350). */
const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(`reports.narrative.${key}`, params ?? {});

type StageTriple = { bronze: StageStatus; silver: StageStatus; gold: StageStatus };

const STAGE_LABEL: Record<keyof StageTriple, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

/** Numeric separators follow screen language — translating text while using Korean numerals looks odd. */
function numberLocale(): string {
  return i18n.language?.startsWith("en") ? "en-US" : "ko-KR";
}

function stageIcon(status: StageStatus): string {
  if (status === "completed") return "✓";
  if (status === "failed") return "✕";
  return status === "not_run" ? t("stage.notRun") : t("stage.unavailable");
}

export interface QualityCounts {
  pass: number;
  warn: number;
  fail: number;
  evaluated: number;
}

// ---------------------------------------------------------------------------
// 1. Data overview
// ---------------------------------------------------------------------------

export function buildOverviewSummary(evidence: ReportEvidenceBundle): string {
  if (!evidence.dataset.ok) {
    return t("overview.loadFailed", {
      datasetId: evidence.datasetId,
      reason: evidence.dataset.reason,
    });
  }
  const dataset = evidence.dataset.value;
  const providers =
    [...new Set(dataset.sources.map((s) => s.provider))].join(", ") || t("unavailable");
  const runStatus = evidence.run.ok ? evidence.run.value.status : null;

  return [
    t("overview.basis", { title: dataset.title, runId: evidence.runId }),
    t("overview.providers", { providers }),
    runStatus ? t("overview.runStatus", { status: runStatus }) : t("overview.runStatusUnknown"),
  ].join(" ");
}

// ---------------------------------------------------------------------------
// 2. Pipeline flow
// ---------------------------------------------------------------------------

function pipelineFlowLine(sourceKey: string, stage: StageTriple): string {
  // Markdown renderer does not make single line-breaks separate lines (GFM hard-break unsupported);
  // split source name and flow as separate paragraphs so bold-text line appears as actual separate line.
  return t("pipeline.flow", {
    sourceKey,
    bronze: stageIcon(stage.bronze),
    silver: stageIcon(stage.silver),
    gold: stageIcon(stage.gold),
  });
}

function pipelineSourceSentence(sourceKey: string, stage: StageTriple): string {
  if (stage.gold === "completed") {
    return t("pipeline.allCompleted", { sourceKey });
  }

  const order: Array<[keyof StageTriple, StageStatus]> = [
    ["bronze", stage.bronze],
    ["silver", stage.silver],
    ["gold", stage.gold],
  ];

  const failedIndex = order.findIndex(([, status]) => status === "failed");
  if (failedIndex !== -1) {
    const [failedStage] = order[failedIndex];
    const next = order[failedIndex + 1];
    if (next && next[1] === "not_run") {
      return t("pipeline.failedAndSkipped", {
        sourceKey,
        failedStage: STAGE_LABEL[failedStage],
        skippedStage: STAGE_LABEL[next[0]],
      });
    }
    return t("pipeline.failed", { sourceKey, stage: STAGE_LABEL[failedStage] });
  }

  const stalled = order.find(([, status]) => status !== "completed");
  if (stalled) {
    const [name, status] = stalled;
    return status === "not_run"
      ? t("pipeline.notRun", { sourceKey, stage: STAGE_LABEL[name] })
      : t("pipeline.stageUnknown", { sourceKey, stage: STAGE_LABEL[name] });
  }

  return t("pipeline.unknown", { sourceKey });
}

export function buildPipelineSummary(evidence: ReportEvidenceBundle): string {
  const sources: Array<[string, StageTriple]> = evidence.stages.ok
    ? evidence.stages.value.sources.map((s) => [
        s.source_key,
        { bronze: s.bronze.status, silver: s.silver.status, gold: s.gold.status },
      ])
    : evidence.dataset.ok
      ? Object.entries(evidence.dataset.value.stages)
      : [];

  if (sources.length === 0) {
    return t("pipeline.noSources");
  }

  const flows = sources.map(([key, stage]) => pipelineFlowLine(key, stage)).join("\n\n");
  const sentences = sources.map(([key, stage]) => pipelineSourceSentence(key, stage)).join(" ");
  return `${flows}\n\n${sentences}`;
}

// ---------------------------------------------------------------------------
// 3. Quality diagnosis
// ---------------------------------------------------------------------------

/** Populate only when actual evidence exists (null if quality response missing or availability=unavailable). */
export function computeQualityCounts(evidence: ReportEvidenceBundle): QualityCounts | null {
  if (!evidence.quality.ok || evidence.quality.value.availability === "unavailable") return null;
  const results = flattenQualityResults(evidence.quality.value);
  return {
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
    evaluated: results.length,
  };
}

function qualityResultSentence(result: QualityCheckResult): string {
  const source = `\`${result.source_key}\``;
  const column = result.column ? `\`${result.column}\`` : null;
  // PASS/WARN/FAIL are Builder's raw values — not translated.
  const verb = result.status === "pass" ? "PASS" : result.status === "warn" ? "WARN" : "FAIL";
  const passed = result.status === "pass";

  if (isMissingCategory(result.category) && result.rule === "max_null_ratio") {
    const actual = formatQualityValue(result.rule, result.actual);
    const threshold = formatQualityValue(result.rule, result.threshold);
    // Pass/fail have different sentence structure; don't swap connectors alone — split full sentences.
    return t(passed ? "quality.missingRatioPass" : "quality.missingRatioFail", {
      source,
      column: column ?? t("quality.targetColumn"),
      actual,
      threshold,
      verb,
    });
  }
  if (isSchemaCategory(result.category) && result.rule === "required_column") {
    if (passed) {
      return t("quality.requiredColumnPass", { source, column: column ?? "", verb });
    }
    return t("quality.requiredColumnFail", {
      source,
      column: column ?? "",
      verb,
      detail: result.detail ? ` (${result.detail})` : "",
    });
  }
  if (result.rule === "min_rows") {
    const actual = formatQualityValue(result.rule, result.actual);
    const threshold = formatQualityValue(result.rule, result.threshold);
    return t(passed ? "quality.minRowsPass" : "quality.minRowsFail", {
      source,
      actual,
      threshold,
      verb,
    });
  }
  if (isDuplicateCategory(result.category)) {
    const actual = formatQualityValue(result.rule, result.actual);
    const threshold = formatQualityValue(result.rule, result.threshold);
    return t(passed ? "quality.duplicatePass" : "quality.duplicateFail", {
      source,
      actual,
      threshold,
      verb,
    });
  }

  // Unknown rule: don't infer meaning; describe actual/expected values as-is.
  const actual = formatQualityValue(result.rule, result.actual);
  const threshold = formatQualityValue(result.rule, result.threshold);
  return t("quality.unknownRule", {
    source,
    rule: result.rule,
    column: column ? ` (${column})` : "",
    verb,
    actual,
    threshold,
    detail: result.detail ? ` ${result.detail}` : "",
  });
}

function schemaDriftSentence(drift: SchemaDriftFinding[]): string {
  if (drift.length === 0) return "";
  const findings = drift
    .map((d) => `\`${d.column ?? "N/A"}\` ${d.kind}(${d.detail})`)
    .join(", ");
  return t("quality.drift", { findings });
}

export function buildQualitySummary(evidence: ReportEvidenceBundle): string {
  if (!evidence.quality.ok) {
    return t("quality.loadFailed", { reason: evidence.quality.reason });
  }
  const quality = evidence.quality.value;
  if (quality.availability === "unavailable") {
    return t("quality.notProvided");
  }

  const results = flattenQualityResults(quality);
  if (results.length === 0) {
    return t("quality.noneEvaluated");
  }

  const pass = results.filter((r) => r.status === "pass").length;
  const warn = results.filter((r) => r.status === "warn").length;
  const fail = results.filter((r) => r.status === "fail").length;
  // If zero WARNs, omit from sentence (mention PASS/FAIL naturally) — but evaluated_checks denominator
  // always uses actual count.
  const parts = [
    t("quality.countPass", { count: pass }),
    warn > 0 ? t("quality.countWarn", { count: warn }) : null,
    t("quality.countFail", { count: fail }),
  ].filter((part): part is string => part !== null);
  const header = t("quality.header", { total: results.length, breakdown: parts.join(", ") });
  const detail = results.map(qualityResultSentence).join(" ");
  const drift = schemaDriftSentence(flattenSchemaDrift(quality));

  return [header, detail, drift].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// 4. Data structure
// ---------------------------------------------------------------------------

function schemaSourceSentence(sourceKey: string, schema: ReportSourceSchema): string {
  const source = `\`${sourceKey}\``;
  if (schema.origin === "silver") {
    const columns = schema.columns.map((c) => `\`${c.name}\``).join(", ");
    return t("schema.silver", { source, columns });
  }
  if (schema.origin === "gold_names_only") {
    const columns =
      (schema.columnNamesOnly ?? []).map((name) => `\`${name}\``).join(", ") || t("unavailable");
    return t("schema.goldNamesOnly", { source, columns });
  }
  return t("schema.unknown", {
    source,
    reason: schema.reason ? ` (${schema.reason})` : "",
  });
}

export function buildSchemaSummary(evidence: ReportEvidenceBundle): string {
  const entries = Object.entries(evidence.schemas);
  if (entries.length === 0) return t("schema.noSources");
  return entries.map(([sourceKey, schema]) => schemaSourceSentence(sourceKey, schema)).join("\n\n");
}

// ---------------------------------------------------------------------------
// 5. Data scale
// ---------------------------------------------------------------------------

export function buildDataSummarySummary(evidence: ReportEvidenceBundle): string {
  if (!evidence.dataset.ok) {
    return t("dataSummary.unavailable", { reason: evidence.dataset.reason });
  }
  const dataset = evidence.dataset.value;
  const rows = Object.entries(dataset.row_counts);
  const locale = numberLocale();
  const totalLine = t("dataSummary.total", {
    total: dataset.total_row_count.toLocaleString(locale),
  });
  if (rows.length === 0) return `${totalLine} ${t("dataSummary.noBreakdown")}`;
  const bySource = rows
    .map(([key, count]) => t("dataSummary.sourceRows", { key, count: count.toLocaleString(locale) }))
    .join(", ");
  return `${totalLine} ${t("dataSummary.composedOf", { bySource })}`;
}

// ---------------------------------------------------------------------------
// 6. Output
// ---------------------------------------------------------------------------

export function buildOutputSummary(evidence: ReportEvidenceBundle): string {
  if (!evidence.output.ok) {
    return `**${t("output.unavailableTitle")}**\n\n${evidence.output.reason}`;
  }
  const files = evidence.output.value.files;
  if (files.length === 0) return t("output.none");
  return t("output.list", {
    count: files.length,
    files: files.map((f) => `\`${f}\``).join(", "),
  });
}

// ---------------------------------------------------------------------------

export function buildSectionSummaries(evidence: ReportEvidenceBundle): Record<BuilderEvidenceSection, string> {
  return {
    overview: buildOverviewSummary(evidence),
    pipeline: buildPipelineSummary(evidence),
    quality: buildQualitySummary(evidence),
    schema: buildSchemaSummary(evidence),
    data_summary: buildDataSummarySummary(evidence),
    output: buildOutputSummary(evidence),
  };
}
