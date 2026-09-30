import { i18n } from "@/shared/i18n";
import {
  ApiError,
  builderApi,
  isRealBuilderEnabled,
  type BuildQualityResponse,
  type DatasetDetailResponse,
  type DatasetQualityHistoryResponse,
  type DatasetRunResponse,
  type DatasetRunsResponse,
  type DatasetSummary,
  type QualityIssue,
  type QualityIssuesResponse,
  type RunStagesResponse,
  type StageDetailResponse,
} from "@/shared/lib/builderApi";
import {
  MOCK_DATASETS,
  MOCK_QUALITY,
  MOCK_QUALITY_HISTORY,
  MOCK_RUNS,
  MOCK_STAGES,
  mockDatasetDetail,
  mockStageDetail,
} from "./mockData";
import { emptyQualityCoverage, issuesFromRunQuality, qualityCoverageBucket, sortQualityIssues } from "./qualityIssues";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

export async function listDatasets(limit = 50, signal?: AbortSignal): Promise<DatasetSummary[]> {
  if (isRealBuilderEnabled()) return (await builderApi.listDatasets(limit, signal)).datasets;
  throwIfAborted(signal);
  return MOCK_DATASETS.datasets.slice(0, limit);
}

/** One page of tables with Builder's `total` (undefined when this Builder does not send it). */
export async function listDatasetsPage(
  limit = 50,
  signal?: AbortSignal,
): Promise<{ datasets: DatasetSummary[]; total: number | undefined }> {
  if (isRealBuilderEnabled()) {
    const response = await builderApi.listDatasets(limit, signal);
    return { datasets: response.datasets, total: response.total };
  }
  throwIfAborted(signal);
  return { datasets: MOCK_DATASETS.datasets.slice(0, limit), total: MOCK_DATASETS.total ?? MOCK_DATASETS.datasets.length };
}

export async function getDataset(datasetId: string, signal?: AbortSignal): Promise<DatasetDetailResponse> {
  if (isRealBuilderEnabled()) return builderApi.getDataset(datasetId, signal);
  throwIfAborted(signal);
  const dataset = mockDatasetDetail(datasetId);
  if (!dataset) throw new ApiError(404, i18n.t("datasets.errors.datasetNotFound"));
  return dataset;
}

export async function listDatasetRuns(datasetId: string, limit = 50, signal?: AbortSignal): Promise<DatasetRunsResponse> {
  if (isRealBuilderEnabled()) return builderApi.listDatasetRuns(datasetId, limit, signal);
  throwIfAborted(signal);
  const runs = MOCK_RUNS[datasetId];
  if (!runs) throw new ApiError(404, i18n.t("datasets.errors.runsNotFound"));
  return { ...runs, runs: runs.runs.slice(0, limit) };
}

/**
 * One run of a dataset by id, not limited to the newest page (#418). Builder answers 404
 * when the run is not this dataset's and 403 when it is not the caller's.
 */
export async function getDatasetRun(datasetId: string, runId: string, signal?: AbortSignal): Promise<DatasetRunResponse> {
  if (isRealBuilderEnabled()) return builderApi.getDatasetRun(datasetId, runId, signal);
  throwIfAborted(signal);
  const run = MOCK_RUNS[datasetId]?.runs.find((candidate) => candidate.run_id === runId);
  if (!run) throw new ApiError(404, i18n.t("datasets.errors.runsNotFound"));
  return { dataset_id: datasetId, run };
}

export async function listBuildStages(runId: string, signal?: AbortSignal): Promise<RunStagesResponse> {
  if (isRealBuilderEnabled()) return builderApi.listBuildStages(runId, signal);
  throwIfAborted(signal);
  const stages = MOCK_STAGES[runId];
  if (!stages) throw new ApiError(404, i18n.t("datasets.errors.stagesNotFound"));
  return stages;
}

export async function getBuildStageDetail(
  runId: string,
  stage: StageDetailResponse["stage"],
  source: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<StageDetailResponse> {
  if (isRealBuilderEnabled()) return builderApi.getBuildStageDetail(runId, stage, source, limit, signal);
  throwIfAborted(signal);
  const detail = mockStageDetail(runId, source, stage);
  if (!detail) throw new ApiError(404, i18n.t("datasets.errors.sourceStageNotFound"));
  return detail.stage === "silver" ? { ...detail, sample: detail.sample.slice(0, limit) } : detail;
}

export async function getBuildQuality(runId: string, signal?: AbortSignal): Promise<BuildQualityResponse> {
  if (isRealBuilderEnabled()) return builderApi.getBuildQuality(runId, signal);
  throwIfAborted(signal);
  const quality = MOCK_QUALITY[runId];
  if (!quality) throw new ApiError(404, i18n.t("datasets.errors.qualityNotFound"));
  return quality;
}

/**
 * The demo's `GET /quality/issues`: the same rows and coverage a Builder would read from
 * each demo table's latest run fixture.
 */
function mockQualityIssues(query: { datasetId?: string; limit?: number }): QualityIssuesResponse {
  const coverage = emptyQualityCoverage();
  const issues: QualityIssue[] = [];
  for (const dataset of MOCK_DATASETS.datasets) {
    if (query.datasetId && dataset.dataset_id !== query.datasetId) continue;
    coverage.tables += 1;
    const quality = MOCK_QUALITY[dataset.latest_run_id];
    if (!quality) {
      coverage.unreadable += 1;
      continue;
    }
    coverage[qualityCoverageBucket(quality)] += 1;
    const finishedAt =
      MOCK_RUNS[dataset.dataset_id]?.runs.find((run) => run.run_id === dataset.latest_run_id)?.finished_at ?? null;
    issues.push(...issuesFromRunQuality({ dataset_id: dataset.dataset_id, title: dataset.title, finished_at: finishedAt }, quality));
  }
  sortQualityIssues(issues);
  return { issues: issues.slice(0, query.limit ?? 100), total: issues.length, next_cursor: null, coverage };
}

/** `GET /quality/issues` (kpubdata-builder#843): findings across tables in one call. */
export async function listQualityIssues(
  query: { datasetId?: string; limit?: number; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<QualityIssuesResponse> {
  if (isRealBuilderEnabled()) return builderApi.listQualityIssues(query, signal);
  throwIfAborted(signal);
  return mockQualityIssues(query);
}

export async function getDatasetQualityHistory(datasetId: string, limit = 30, signal?: AbortSignal): Promise<DatasetQualityHistoryResponse> {
  if (isRealBuilderEnabled()) return builderApi.getDatasetQualityHistory(datasetId, limit, signal);
  throwIfAborted(signal);
  const history = MOCK_QUALITY_HISTORY[datasetId];
  if (!history) throw new ApiError(404, i18n.t("datasets.errors.qualityHistoryNotFound"));
  return { ...history, runs: history.runs.slice(0, limit) };
}

/** Runs `mapper` over `values` with at most `concurrency` calls in flight. */
export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}
