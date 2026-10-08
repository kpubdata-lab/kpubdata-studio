/**
 * The datasets client: one interface, and the two things that implement it (#794).
 *
 * Studio runs against a Builder, or without one on the demo's fixtures. Each function
 * of this feature's API used to choose between the two in its own body
 * (`if (isRealBuilderEnabled()) … else …`), so nothing said that the two answer the same
 * question the same way — the same shape, the same refusal for an id that is not there,
 * the same behaviour when the caller has given up.
 *
 * `DatasetsClient` is that statement. `realDatasetsClient` asks Builder;
 * `demoDatasetsClient` reads the fixtures; `client.contract.test.ts` runs one set of
 * expectations over both. The feature's functions (`./index`) call `datasetsClient()`
 * and do not know which they got.
 */
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
  type DatasetsResponse,
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

export type QualityIssuesQuery = { datasetId?: string; limit?: number; cursor?: string };

/**
 * What the datasets screens ask for. Every method:
 *
 * - resolves with the response as Builder's contract shapes it;
 * - rejects with an `ApiError` whose `status` is 404 when the id names nothing;
 * - rejects, without an answer, when `signal` is already aborted.
 */
export interface DatasetsClient {
  listDatasets(limit: number, signal?: AbortSignal): Promise<DatasetsResponse>;
  getDataset(datasetId: string, signal?: AbortSignal): Promise<DatasetDetailResponse>;
  listDatasetRuns(datasetId: string, limit: number, signal?: AbortSignal): Promise<DatasetRunsResponse>;
  getDatasetRun(datasetId: string, runId: string, signal?: AbortSignal): Promise<DatasetRunResponse>;
  listBuildStages(runId: string, signal?: AbortSignal): Promise<RunStagesResponse>;
  getBuildStageDetail(
    runId: string,
    stage: StageDetailResponse["stage"],
    source: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<StageDetailResponse>;
  getBuildQuality(runId: string, signal?: AbortSignal): Promise<BuildQualityResponse>;
  listQualityIssues(query: QualityIssuesQuery, signal?: AbortSignal): Promise<QualityIssuesResponse>;
  getDatasetQualityHistory(datasetId: string, limit: number, signal?: AbortSignal): Promise<DatasetQualityHistoryResponse>;
}

export const realDatasetsClient: DatasetsClient = {
  listDatasets: async (limit, signal) => builderApi.listDatasets(limit, signal),
  getDataset: async (datasetId, signal) => builderApi.getDataset(datasetId, signal),
  listDatasetRuns: async (datasetId, limit, signal) => builderApi.listDatasetRuns(datasetId, limit, signal),
  getDatasetRun: async (datasetId, runId, signal) => builderApi.getDatasetRun(datasetId, runId, signal),
  listBuildStages: async (runId, signal) => builderApi.listBuildStages(runId, signal),
  getBuildStageDetail: async (runId, stage, source, limit, signal) =>
    builderApi.getBuildStageDetail(runId, stage, source, limit, signal),
  getBuildQuality: async (runId, signal) => builderApi.getBuildQuality(runId, signal),
  listQualityIssues: async (query, signal) => builderApi.listQualityIssues(query, signal),
  getDatasetQualityHistory: async (datasetId, limit, signal) => builderApi.getDatasetQualityHistory(datasetId, limit, signal),
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function found<T>(value: T | undefined, messageKey: string): T {
  if (value === undefined) throw new ApiError(404, i18n.t(messageKey));
  return value;
}

/**
 * The demo's `GET /quality/issues`: the same rows and coverage a Builder would read from
 * each demo table's latest run fixture.
 */
function demoQualityIssues(query: QualityIssuesQuery): QualityIssuesResponse {
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

export const demoDatasetsClient: DatasetsClient = {
  async listDatasets(limit, signal) {
    throwIfAborted(signal);
    return { ...MOCK_DATASETS, datasets: MOCK_DATASETS.datasets.slice(0, limit), total: MOCK_DATASETS.total ?? MOCK_DATASETS.datasets.length };
  },
  async getDataset(datasetId, signal) {
    throwIfAborted(signal);
    return found(mockDatasetDetail(datasetId), "datasets.errors.datasetNotFound");
  },
  async listDatasetRuns(datasetId, limit, signal) {
    throwIfAborted(signal);
    const runs = found(MOCK_RUNS[datasetId], "datasets.errors.runsNotFound");
    return { ...runs, runs: runs.runs.slice(0, limit) };
  },
  async getDatasetRun(datasetId, runId, signal) {
    throwIfAborted(signal);
    const run = found(
      MOCK_RUNS[datasetId]?.runs.find((candidate) => candidate.run_id === runId),
      "datasets.errors.runsNotFound",
    );
    return { dataset_id: datasetId, run };
  },
  async listBuildStages(runId, signal) {
    throwIfAborted(signal);
    return found(MOCK_STAGES[runId], "datasets.errors.stagesNotFound");
  },
  async getBuildStageDetail(runId, stage, source, limit, signal) {
    throwIfAborted(signal);
    const detail = found(mockStageDetail(runId, source, stage), "datasets.errors.sourceStageNotFound");
    return detail.stage === "silver" ? { ...detail, sample: detail.sample.slice(0, limit) } : detail;
  },
  async getBuildQuality(runId, signal) {
    throwIfAborted(signal);
    return found(MOCK_QUALITY[runId], "datasets.errors.qualityNotFound");
  },
  async listQualityIssues(query, signal) {
    throwIfAborted(signal);
    return demoQualityIssues(query);
  },
  async getDatasetQualityHistory(datasetId, limit, signal) {
    throwIfAborted(signal);
    const history = found(MOCK_QUALITY_HISTORY[datasetId], "datasets.errors.qualityHistoryNotFound");
    return { ...history, runs: history.runs.slice(0, limit) };
  },
};

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function datasetsClient(): DatasetsClient {
  return isRealBuilderEnabled() ? realDatasetsClient : demoDatasetsClient;
}
