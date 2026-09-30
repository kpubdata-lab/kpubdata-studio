/**
 * Actionable quality issues across tables (#536).
 *
 * Quality Center lists, in one table, what needs a person's attention in every table's
 * latest refresh: WARN and FAIL results and schema drift findings, all from
 * `GET /builds/{run_id}/quality`. Studio neither scores nor re-judges a result (#246).
 *
 * Builder has no cross-table issues endpoint yet (kpubdata-builder#843),
 * so the list is assembled from each table's latest run, at most four requests at a
 * time. A table whose quality could not be read is counted as such — never as clean —
 * and a table with nothing evaluated is "not evaluated", never PASS.
 */
import { getBuildQuality, listDatasetsPage } from "@/features/datasets/api";
import type {
  BuildQualityResponse,
  DatasetSummary,
  QualityCheckResult,
  SchemaDriftFinding,
} from "@/shared/lib/builderApi";

/** How many tables the list reads. Builder's `total` says whether there are more. */
export const QUALITY_TABLE_LIMIT = 100;

export type TableQuality =
  | { dataset: DatasetSummary; status: "loaded"; quality: BuildQualityResponse }
  | { dataset: DatasetSummary; status: "error"; message: string };

export interface QualityOverview {
  tables: TableQuality[];
  /** Builder's table count; undefined when this Builder does not send it. */
  total: number | undefined;
}

export type IssueRow =
  | { kind: "check"; dataset: DatasetSummary; runId: string; result: QualityCheckResult }
  | { kind: "drift"; dataset: DatasetSummary; runId: string; sourceKey: string; finding: SchemaDriftFinding };

/** The status filter's values. `drift` is a schema drift finding. */
export type IssueStatus = "fail" | "warn" | "drift";

/** The category a drift finding is filed under, next to Builder's check categories. */
export const DRIFT_CATEGORY = "schema_drift";

export function issueStatus(row: IssueRow): IssueStatus {
  return row.kind === "drift" ? "drift" : row.result.status === "fail" ? "fail" : "warn";
}

export function issueCategory(row: IssueRow): string {
  return row.kind === "drift" ? DRIFT_CATEGORY : row.result.category;
}

export function issueSource(row: IssueRow): string {
  return row.kind === "drift" ? row.sourceKey : row.result.source_key;
}

const SEVERITY: Record<IssueStatus, number> = { fail: 0, warn: 1, drift: 2 };

/** Every WARN/FAIL result and every drift finding, FAIL first, then by table title. */
export function collectIssues(tables: TableQuality[]): IssueRow[] {
  const rows: IssueRow[] = [];
  for (const table of tables) {
    if (table.status !== "loaded") continue;
    const runId = table.quality.run_id;
    for (const results of Object.values(table.quality.quality_results)) {
      for (const result of results) {
        if (result.status !== "pass") rows.push({ kind: "check", dataset: table.dataset, runId, result });
      }
    }
    for (const [sourceKey, findings] of Object.entries(table.quality.schema_drift)) {
      for (const finding of findings) rows.push({ kind: "drift", dataset: table.dataset, runId, sourceKey, finding });
    }
  }
  return rows.sort(
    (a, b) => SEVERITY[issueStatus(a)] - SEVERITY[issueStatus(b)] || a.dataset.title.localeCompare(b.dataset.title),
  );
}

export interface QualityCoverage {
  /** Tables with at least one WARN, FAIL or drift finding. */
  withIssues: DatasetSummary[];
  /** Evaluated, every result PASS, no drift. */
  passed: DatasetSummary[];
  /** Nothing evaluated in the latest refresh (N/A) — not counted as passed. */
  notEvaluated: DatasetSummary[];
  /** Builder said only part of the results is available. */
  partial: DatasetSummary[];
  /** Quality could not be read. */
  failed: DatasetSummary[];
}

export function qualityCoverage(tables: TableQuality[]): QualityCoverage {
  const coverage: QualityCoverage = { withIssues: [], passed: [], notEvaluated: [], partial: [], failed: [] };
  for (const table of tables) {
    if (table.status === "error") {
      coverage.failed.push(table.dataset);
      continue;
    }
    const results = Object.values(table.quality.quality_results).flat();
    const drift = Object.values(table.quality.schema_drift).flat();
    if (table.quality.availability === "partial") coverage.partial.push(table.dataset);
    if (results.some((result) => result.status !== "pass") || drift.length > 0) coverage.withIssues.push(table.dataset);
    else if (results.length === 0) coverage.notEvaluated.push(table.dataset);
    else coverage.passed.push(table.dataset);
  }
  return coverage;
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

/** Read every listed table's latest-run quality; one table's failure stays that table's. */
export async function loadQualityOverview(signal?: AbortSignal): Promise<QualityOverview> {
  const page = await listDatasetsPage(QUALITY_TABLE_LIMIT, signal);
  const tables = await mapWithConcurrency(page.datasets, 4, async (dataset): Promise<TableQuality> => {
    try {
      return { dataset, status: "loaded", quality: await getBuildQuality(dataset.latest_run_id, signal) };
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return { dataset, status: "error", message: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  return { tables, total: page.total };
}
