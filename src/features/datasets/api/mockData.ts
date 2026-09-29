import type {
  BuildQualityResponse,
  DatasetDetailResponse,
  DatasetQualityHistoryResponse,
  DatasetRunsResponse,
  DatasetsResponse,
  RunStagesResponse,
  StageDetailResponse,
} from "@/shared/lib/builderApi";
import { DEMO_DATASETS } from "@/shared/lib/demoDatasets";

export const MOCK_DATASETS: DatasetsResponse = {
  datasets: [
    {
      dataset_id: "air-quality",
      title: "대기질 통합 데이터",
      sources: [
        { provider: "data.go.kr", dataset: "air", alias: "서울 대기질" },
        { provider: "kma", dataset: "weather", alias: "기상 관측" },
      ],
      latest_run_id: "air-2026-08-14",
      status: "failed",
      updated_at: "2026-08-14T07:30:00Z",
      row_counts: { datago__air: 1000, kma__weather: 200 },
      total_row_count: 1200,
      stages: {
        datago__air: { bronze: "completed", silver: "completed", gold: "completed" },
        kma__weather: { bronze: "completed", silver: "failed", gold: "not_run" },
      },
      status_axes: { refresh: "failed", completeness: "partial", health: "unknown", access: "unknown", maturity: "unknown" },
      quality: null,
    },
    {
      dataset_id: "population",
      title: "행정구역별 인구",
      sources: [{ provider: "kosis", dataset: "population", alias: "주민등록 인구" }],
      latest_run_id: "population-2026-08-13",
      status: "ok",
      updated_at: "2026-08-13T09:00:00Z",
      row_counts: { kosis__population: 229 },
      total_row_count: 229,
      stages: {
        kosis__population: { bronze: "completed", silver: "completed", gold: "unavailable" },
      },
      status_axes: { refresh: "succeeded", completeness: "complete", health: "unknown", access: "unknown", maturity: "unknown" },
      quality: null,
    },
    {
      dataset_id: "transport",
      title: "대중교통 운행 현황",
      sources: [{ provider: "seoul", dataset: "transport", alias: "서울 교통" }],
      latest_run_id: "transport-2026-08-12",
      status: "ok",
      updated_at: "2026-08-12T04:10:00Z",
      row_counts: { seoul__transport: 540 },
      total_row_count: 540,
      stages: {
        seoul__transport: { bronze: "completed", silver: "completed", gold: "completed" },
      },
      status_axes: { refresh: "running", completeness: "complete", health: "unknown", access: "unknown", maturity: "unknown" },
      quality: null,
    },
  ],
};

export const MOCK_RUNS: Record<string, DatasetRunsResponse> = {
  "air-quality": {
    dataset_id: "air-quality",
    runs: [
      { run_id: "air-2026-08-14", status: "failed", started_at: "2026-08-14T07:00:00Z", finished_at: "2026-08-14T07:30:00Z", spec_digest: "sha256:air14", created_by: "user@example.com" },
      { run_id: "air-2026-08-13", status: "ok", started_at: "2026-08-13T07:00:00Z", finished_at: "2026-08-13T07:20:00Z", spec_digest: "sha256:air13", created_by: "user@example.com" },
    ],
  },
  population: {
    dataset_id: "population",
    runs: [{ run_id: "population-2026-08-13", status: "ok", started_at: "2026-08-13T08:45:00Z", finished_at: "2026-08-13T09:00:00Z", spec_digest: null, created_by: null }],
  },
  transport: {
    dataset_id: "transport",
    runs: [{ run_id: "transport-2026-08-12", status: "ok", started_at: "2026-08-12T04:00:00Z", finished_at: "2026-08-12T04:10:00Z", spec_digest: null, created_by: null }],
  },
};

export const MOCK_STAGES: Record<string, RunStagesResponse> = {
  // Aligns so stage/quality fixtures are also reachable under the run ids
  // the Builds/Runs list actually uses (mockBuilds → DEMO_DATASETS.buildId)
  // (#255 closing fix). No new mock semantics — reuses the exact shape of
  // the air-2026-08-* fixtures below.
  "air-quality-20260621": {
    run_id: "air-quality-20260621",
    sources: [
      { source_key: "datago__air_quality", bronze: { status: "completed", available: true }, silver: { status: "completed", available: true }, gold: { status: "completed", available: true } },
    ],
  },
  "dur-older-adult-caution-20260618": {
    run_id: "dur-older-adult-caution-20260618",
    sources: [
      { source_key: "datago__dur_older_adult_caution", bronze: { status: "failed", available: false }, silver: { status: "not_run", available: false }, gold: { status: "not_run", available: false } },
    ],
  },
  // succeeded DEMO_DATASETS run — bronze/silver/gold all completed (#255 closing fix, fixture consistency).
  "dur-product-info-20260620": {
    run_id: "dur-product-info-20260620",
    sources: [
      { source_key: "datago__dur_product_info", bronze: { status: "completed", available: true }, silver: { status: "completed", available: true }, gold: { status: "completed", available: true } },
    ],
  },
  "dur-usjnt-taboo-20260620": {
    run_id: "dur-usjnt-taboo-20260620",
    sources: [
      { source_key: "datago__dur_usjnt_taboo", bronze: { status: "completed", available: true }, silver: { status: "completed", available: true }, gold: { status: "completed", available: true } },
    ],
  },
  // running/queued DEMO_DATASETS run — the Builder RunStages contract has no
  // in-progress states, so none are invented; only not_run/unavailable are
  // used (#255 closing principle).
  "dur-pregnancy-taboo-20260621": {
    run_id: "dur-pregnancy-taboo-20260621",
    sources: [
      { source_key: "datago__dur_pregnancy_taboo", bronze: { status: "not_run", available: false }, silver: { status: "not_run", available: false }, gold: { status: "not_run", available: false } },
    ],
  },
  "dur-dosage-caution-20260621": {
    run_id: "dur-dosage-caution-20260621",
    sources: [
      { source_key: "datago__dur_dosage_caution", bronze: { status: "not_run", available: false }, silver: { status: "not_run", available: false }, gold: { status: "not_run", available: false } },
    ],
  },
  "air-2026-08-14": {
    run_id: "air-2026-08-14",
    sources: [
      { source_key: "datago__air", bronze: { status: "completed", available: true }, silver: { status: "completed", available: true }, gold: { status: "completed", available: true } },
      { source_key: "kma__weather", bronze: { status: "completed", available: true }, silver: { status: "failed", available: false }, gold: { status: "not_run", available: false } },
    ],
  },
  "air-2026-08-13": {
    run_id: "air-2026-08-13",
    sources: [
      { source_key: "datago__air", bronze: { status: "completed", available: true }, silver: { status: "completed", available: true }, gold: { status: "completed", available: true } },
      { source_key: "kma__weather", bronze: { status: "completed", available: true }, silver: { status: "completed", available: true }, gold: { status: "completed", available: true } },
    ],
  },
  "population-2026-08-13": {
    run_id: "population-2026-08-13",
    sources: [{ source_key: "kosis__population", bronze: { status: "completed", available: true }, silver: { status: "completed", available: true }, gold: { status: "unavailable", available: false } }],
  },
  "transport-2026-08-12": {
    run_id: "transport-2026-08-12",
    sources: [{ source_key: "seoul__transport", bronze: { status: "completed", available: true }, silver: { status: "completed", available: true }, gold: { status: "completed", available: true } }],
  },
};

export const MOCK_QUALITY: Record<string, BuildQualityResponse> = {
  // Same run-id alignment as MOCK_STAGES (#255) — attaches real Quality
  // results to the one succeeded and one failed run mockBuilds() actually
  // exposes.
  "air-quality-20260621": {
    run_id: "air-quality-20260621",
    availability: "available",
    evaluated_checks: 1,
    quality_results: {
      datago__air_quality: [
        { source_key: "datago__air_quality", category: "row_count", rule: "min_rows", column: null, status: "pass", actual: 12304, threshold: 100, affected_rows: null, evaluated_rows: 12304, detail: null },
      ],
    },
    schema_drift: { datago__air_quality: [] },
  },
  // A run that failed at bronze, so quality was never computed (N/A ≠
  // PASS) — consistent with MOCK_STAGES' bronze failed; nothing invented.
  "dur-older-adult-caution-20260618": {
    run_id: "dur-older-adult-caution-20260618",
    availability: "unavailable",
    evaluated_checks: 0,
    quality_results: {},
    schema_drift: {},
  },
  // succeeded — minimal quality fixture consistent with the real DEMO_DATASETS recordCount (no invented rules).
  "dur-product-info-20260620": {
    run_id: "dur-product-info-20260620",
    availability: "available",
    evaluated_checks: 1,
    quality_results: {
      datago__dur_product_info: [
        { source_key: "datago__dur_product_info", category: "row_count", rule: "min_rows", column: null, status: "pass", actual: 48512, threshold: 100, affected_rows: null, evaluated_rows: 48512, detail: null },
      ],
    },
    schema_drift: { datago__dur_product_info: [] },
  },
  "dur-usjnt-taboo-20260620": {
    run_id: "dur-usjnt-taboo-20260620",
    availability: "available",
    evaluated_checks: 1,
    quality_results: {
      datago__dur_usjnt_taboo: [
        { source_key: "datago__dur_usjnt_taboo", category: "row_count", rule: "min_rows", column: null, status: "pass", actual: 31894, threshold: 100, affected_rows: null, evaluated_rows: 31894, detail: null },
      ],
    },
    schema_drift: { datago__dur_usjnt_taboo: [] },
  },
  // running/queued — not yet evaluated (N/A ≠ PASS). Consistent with MOCK_STAGES' not_run.
  "dur-pregnancy-taboo-20260621": {
    run_id: "dur-pregnancy-taboo-20260621",
    availability: "unavailable",
    evaluated_checks: 0,
    quality_results: {},
    schema_drift: {},
  },
  "dur-dosage-caution-20260621": {
    run_id: "dur-dosage-caution-20260621",
    availability: "unavailable",
    evaluated_checks: 0,
    quality_results: {},
    schema_drift: {},
  },
  "air-2026-08-14": {
    run_id: "air-2026-08-14",
    availability: "partial",
    evaluated_checks: 2,
    quality_results: {
      datago__air: [{ source_key: "datago__air", category: "missing", rule: "max_null_ratio", column: "pm10", status: "pass", actual: 0.01, threshold: 0.05, affected_rows: 10, evaluated_rows: 1000, detail: null }],
      kma__weather: [{ source_key: "kma__weather", category: "schema", rule: "required_column", column: "temperature", status: "fail", actual: false, threshold: true, affected_rows: null, evaluated_rows: null, detail: "필수 컬럼이 없습니다." }],
    },
    schema_drift: { datago__air: [], kma__weather: [{ kind: "column_removed", column: "temperature", detail: "temperature 컬럼이 제거되었습니다." }] },
  },
  "air-2026-08-13": {
    run_id: "air-2026-08-13",
    availability: "available",
    evaluated_checks: 2,
    quality_results: {
      datago__air: [{ source_key: "datago__air", category: "row_count", rule: "min_rows", column: null, status: "pass", actual: 1000, threshold: 100, affected_rows: null, evaluated_rows: 1000, detail: null }],
      kma__weather: [{ source_key: "kma__weather", category: "missing", rule: "max_null_ratio", column: "humidity", status: "warn", actual: 0.08, threshold: 0.05, affected_rows: 16, evaluated_rows: 200, detail: null }],
    },
    schema_drift: { datago__air: [], kma__weather: [] },
  },
  "population-2026-08-13": { run_id: "population-2026-08-13", availability: "unavailable", evaluated_checks: 0, quality_results: {}, schema_drift: {} },
  "transport-2026-08-12": {
    run_id: "transport-2026-08-12",
    availability: "available",
    evaluated_checks: 1,
    quality_results: { seoul__transport: [{ source_key: "seoul__transport", category: "duplicate", rule: "max_duplicate_rate", column: null, status: "pass", actual: 0, threshold: 0.01, affected_rows: 0, evaluated_rows: 540, detail: null }] },
    schema_drift: { seoul__transport: [] },
  },
};

export const MOCK_QUALITY_HISTORY: Record<string, DatasetQualityHistoryResponse> = {
  "air-quality": { dataset_id: "air-quality", runs: [
    { run_id: "air-2026-08-14", timestamp: "2026-08-14T07:30:00Z", status: "failed", pass_count: 1, warn_count: 0, fail_count: 1, evaluated_checks: 2, rule_pass_rate: 0.5, validated_rows: 1200 },
    { run_id: "air-2026-08-13", timestamp: "2026-08-13T07:20:00Z", status: "ok", pass_count: 1, warn_count: 1, fail_count: 0, evaluated_checks: 2, rule_pass_rate: 0.5, validated_rows: 1200 },
  ] },
  population: { dataset_id: "population", runs: [{ run_id: "population-2026-08-13", timestamp: "2026-08-13T09:00:00Z", status: "ok", pass_count: 0, warn_count: 0, fail_count: 0, evaluated_checks: 0, rule_pass_rate: null, validated_rows: 229 }] },
  transport: { dataset_id: "transport", runs: [{ run_id: "transport-2026-08-12", timestamp: "2026-08-12T04:10:00Z", status: "ok", pass_count: 1, warn_count: 0, fail_count: 0, evaluated_checks: 1, rule_pass_rate: 1, validated_rows: 540 }] },
};

export function mockDatasetDetail(datasetId: string): DatasetDetailResponse | undefined {
  const dataset = MOCK_DATASETS.datasets.find((item) => item.dataset_id === datasetId);
  return dataset ? { ...dataset, run_count: MOCK_RUNS[datasetId]?.runs.length ?? 0 } : undefined;
}

/** DEMO_DATASETS.buildId → that demo dataset (the runs the Builds/Runs screens use). */
const DEMO_DATASET_BY_BUILD_ID = new Map(DEMO_DATASETS.map((dataset) => [dataset.buildId, dataset] as const));

/** The single source_key a DEMO_DATASETS dataset actually uses in this run (providerDataset-based). */
function demoSourceKey(dataset: (typeof DEMO_DATASETS)[number]): string {
  return `datago__${dataset.providerDataset}`;
}

/**
 * For a DEMO_DATASETS run (runId) of the Builds/Runs screens (#255),
 * builds the Stage detail from that run's actual demo values
 * (recordCount/dates/fields/exports) instead of the generic weather-shaped
 * fixture (#286 follow-up §2). Existing dataset-catalog-only runs like
 * air-2026-08-14 (not in DEMO_DATASETS) get undefined from this function
 * and fall straight through to the generic fixture below — existing screen
 * behavior unchanged.
 */
function demoStageDetail(
  runId: string,
  sourceKey: string,
  stage: "bronze" | "silver" | "gold",
  state: { status: StageDetailResponse["status"]; available: boolean },
): StageDetailResponse | undefined {
  const dataset = DEMO_DATASET_BY_BUILD_ID.get(runId);
  if (!dataset || sourceKey !== demoSourceKey(dataset)) return undefined;

  if (stage === "bronze") {
    return {
      run_id: runId,
      stage,
      source_key: sourceKey,
      ...state,
      provider: "datago",
      dataset: dataset.providerDataset,
      // Uses this run's actual startedAt to avoid contradicting the Run time (no generic 2026-08-14).
      fetched_at: state.available ? dataset.startedAt : null,
      record_count: state.available ? dataset.recordCount : null,
    };
  }
  if (stage === "silver") {
    const schema = dataset.fields.map((field) => ({
      name: field.name,
      dtype: field.type,
      nullable: field.nullable,
      // Not actually computed — never invents numbers that look precise.
      unique_count: 0,
    }));
    return {
      run_id: runId,
      stage,
      source_key: sourceKey,
      ...state,
      row_count: state.available ? dataset.recordCount : null,
      schema: state.available ? schema : [],
      statistics: state.available
        ? {
            row_count: dataset.recordCount,
            null_counts: Object.fromEntries(dataset.fields.map((field) => [field.name, 0])),
            duplicate_rate: 0,
          }
        : null,
      validation: state.available ? { ok: true, problems: [] } : null,
      // No basis to fabricate row samples, so an empty array (no fake medical/DUR values).
      sample: [],
    };
  }
  return {
    run_id: runId,
    stage,
    source_key: sourceKey,
    ...state,
    row_count: state.available ? dataset.recordCount : null,
    columns: state.available ? dataset.fields.map((field) => field.name) : [],
    // DEMO_DATASETS has no split info, so none is invented.
    splits: null,
    // Reflects the actual demo export formats (e.g. air-quality → parquet + huggingface).
    exports: state.available ? dataset.exports.map((target) => ({ kind: target.format })) : [],
    sample: null,
    sample_available: false,
  };
}

export function mockStageDetail(runId: string, sourceKey: string, stage: "bronze" | "silver" | "gold"): StageDetailResponse | undefined {
  const source = MOCK_STAGES[runId]?.sources.find((item) => item.source_key === sourceKey);
  if (!source) return undefined;
  const state = source[stage];

  const demo = demoStageDetail(runId, sourceKey, stage, state);
  if (demo) return demo;

  if (stage === "bronze") return { run_id: runId, stage, source_key: sourceKey, ...state, provider: sourceKey.split("__")[0] ?? null, dataset: sourceKey.split("__")[1] ?? null, fetched_at: state.available ? "2026-08-14T07:05:00Z" : null, record_count: state.available ? 1200 : null };
  if (stage === "silver") return { run_id: runId, stage, source_key: sourceKey, ...state, row_count: state.available ? 1200 : null, schema: state.available ? [{ name: "observed_at", dtype: "datetime", nullable: false, unique_count: 1200 }, { name: "value", dtype: "float64", nullable: true, unique_count: 480 }] : [], statistics: state.available ? { row_count: 1200, null_counts: { observed_at: 0, value: 4 }, duplicate_rate: 0 } : null, validation: state.available ? { ok: true, problems: [] } : null, sample: state.available ? [{ observed_at: "2026-08-14T00:00:00Z", value: 24.2 }, { observed_at: "2026-08-14T01:00:00Z", value: 23.8 }] : [] };
  return { run_id: runId, stage, source_key: sourceKey, ...state, row_count: state.available ? 1200 : null, columns: state.available ? ["observed_at", "value"] : [], splits: null, exports: state.available ? [{ kind: "parquet" }] : [], sample: null, sample_available: false };
}
