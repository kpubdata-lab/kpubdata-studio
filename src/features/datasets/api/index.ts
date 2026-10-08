/**
 * The datasets API the screens call. Each function asks the client in force
 * (`./client`): Builder's when one is configured, the demo's otherwise. Which of the two
 * answers is decided there and nowhere in this file (#794).
 */
import type {
  BuildQualityResponse,
  DatasetDetailResponse,
  DatasetQualityHistoryResponse,
  DatasetRunResponse,
  DatasetRunsResponse,
  DatasetSummary,
  QualityIssuesResponse,
  RunStagesResponse,
  StageDetailResponse,
} from "@/shared/lib/builderApi";
import { datasetsClient, type QualityIssuesQuery } from "./client";

export async function listDatasets(limit = 50, signal?: AbortSignal): Promise<DatasetSummary[]> {
  return (await datasetsClient().listDatasets(limit, signal)).datasets;
}

/** One page of tables with Builder's `total` (undefined when this Builder does not send it). */
export async function listDatasetsPage(
  limit = 50,
  signal?: AbortSignal,
): Promise<{ datasets: DatasetSummary[]; total: number | undefined }> {
  const response = await datasetsClient().listDatasets(limit, signal);
  return { datasets: response.datasets, total: response.total };
}

export async function getDataset(datasetId: string, signal?: AbortSignal): Promise<DatasetDetailResponse> {
  return datasetsClient().getDataset(datasetId, signal);
}

export async function listDatasetRuns(datasetId: string, limit = 50, signal?: AbortSignal): Promise<DatasetRunsResponse> {
  return datasetsClient().listDatasetRuns(datasetId, limit, signal);
}

/**
 * One run of a dataset by id, not limited to the newest page (#418). Builder answers 404
 * when the run is not this dataset's and 403 when it is not the caller's.
 */
export async function getDatasetRun(datasetId: string, runId: string, signal?: AbortSignal): Promise<DatasetRunResponse> {
  return datasetsClient().getDatasetRun(datasetId, runId, signal);
}

export async function listBuildStages(runId: string, signal?: AbortSignal): Promise<RunStagesResponse> {
  return datasetsClient().listBuildStages(runId, signal);
}

export async function getBuildStageDetail(
  runId: string,
  stage: StageDetailResponse["stage"],
  source: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<StageDetailResponse> {
  return datasetsClient().getBuildStageDetail(runId, stage, source, limit, signal);
}

export async function getBuildQuality(runId: string, signal?: AbortSignal): Promise<BuildQualityResponse> {
  return datasetsClient().getBuildQuality(runId, signal);
}

/** `GET /quality/issues` (kpubdata-builder#843): findings across tables in one call. */
export async function listQualityIssues(query: QualityIssuesQuery = {}, signal?: AbortSignal): Promise<QualityIssuesResponse> {
  return datasetsClient().listQualityIssues(query, signal);
}

export async function getDatasetQualityHistory(datasetId: string, limit = 30, signal?: AbortSignal): Promise<DatasetQualityHistoryResponse> {
  return datasetsClient().getDatasetQualityHistory(datasetId, limit, signal);
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
