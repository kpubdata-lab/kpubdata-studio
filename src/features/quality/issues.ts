/**
 * Actionable quality issues across tables (#536, #568).
 *
 * Quality Center lists, in one table, what needs a person's attention in every table's
 * latest refresh: WARN and FAIL results and schema drift findings. They come from one
 * KPubData Builder call, `GET /quality/issues` (kpubdata-builder#843), which reads each
 * visible table's latest run, orders the rows failures first and counts the tables it
 * read by what their latest run says — evaluated, not evaluated, partial, unreadable —
 * so a table without results is never taken for a passing one. Studio neither scores
 * nor re-judges a result (#246).
 *
 * The call is paged by an opaque cursor; the page follows it up to
 * `QUALITY_ISSUE_PAGES` pages and says so when rows remain beyond that. A Builder older
 * than contract 1.49.0 answers 404, and the page falls back to the per-table reads it
 * made before (first 100 tables, four at a time).
 */
import {
  getBuildQuality,
  getDataset,
  listDatasetsPage,
  listQualityIssues,
  mapWithConcurrency,
} from "@/features/datasets/api";
import {
  emptyQualityCoverage,
  issuesFromRunQuality,
  qualityCoverageBucket,
  sortQualityIssues,
} from "@/features/datasets/api/qualityIssues";
import { ApiError, type QualityIssue, type QualityIssuesCoverage } from "@/shared/lib/builderApi";

/** Rows per request: the contract's maximum. */
export const QUALITY_ISSUE_PAGE_SIZE = 500;
/** Pages followed before the list stops and says how many rows it left out. */
export const QUALITY_ISSUE_PAGES = 10;
/** Tables an older Builder's per-table fallback reads. */
export const LEGACY_TABLE_LIMIT = 100;

export type IssueRow = QualityIssue;

export interface QualityOverview {
  issues: IssueRow[];
  /** Rows matching across all pages (Builder's `total`). */
  total: number;
  coverage: QualityIssuesCoverage;
  /**
   * Set only by the per-table fallback for an older Builder: how many tables it read, and
   * Builder's table count (undefined when not sent).
   */
  legacyTables?: { shown: number; total: number | undefined };
}

/** The status filter's values. `drift` is a schema drift finding. */
export type IssueStatus = "fail" | "warn" | "drift";

/** The category a drift finding is filed under, next to Builder's check categories. */
export const DRIFT_CATEGORY = "schema_drift";

export function issueStatus(row: IssueRow): IssueStatus {
  return row.status;
}

export function issueCategory(row: IssueRow): string {
  return row.kind === "drift" ? DRIFT_CATEGORY : (row.category ?? row.check?.category ?? "");
}

export function issueSource(row: IssueRow): string {
  return row.source_key;
}

/** The label a row's table goes by: Builder's title, or its id when it sent none. */
export function issueTableTitle(row: Pick<IssueRow, "title" | "dataset_id">): string {
  return row.title ?? row.dataset_id;
}

/** The tables the rows name, in first-seen order (Builder orders the rows). */
export function issueTables(rows: IssueRow[]): { datasetId: string; title: string; runId: string }[] {
  const seen = new Map<string, { datasetId: string; title: string; runId: string }>();
  for (const row of rows) {
    if (!seen.has(row.dataset_id)) {
      seen.set(row.dataset_id, { datasetId: row.dataset_id, title: issueTableTitle(row), runId: row.run_id });
    }
  }
  return [...seen.values()];
}

function isNotFound(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404;
}

/**
 * A Builder before contract 1.49.0 has no `GET /quality/issues`: read the first
 * `LEGACY_TABLE_LIMIT` tables' latest-run quality, four at a time, into the same rows and
 * coverage. A table whose quality could not be read is unreadable, never clean.
 */
async function loadPerTable(signal?: AbortSignal): Promise<QualityOverview> {
  const page = await listDatasetsPage(LEGACY_TABLE_LIMIT, signal);
  const coverage = emptyQualityCoverage();
  coverage.tables = page.datasets.length;
  const perTable = await mapWithConcurrency(page.datasets, 4, async (dataset) => {
    try {
      return { dataset, quality: await getBuildQuality(dataset.latest_run_id, signal) };
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return { dataset, quality: null };
    }
  });
  const issues: IssueRow[] = [];
  for (const { dataset, quality } of perTable) {
    if (!quality) {
      coverage.unreadable += 1;
      continue;
    }
    coverage[qualityCoverageBucket(quality)] += 1;
    issues.push(...issuesFromRunQuality({ dataset_id: dataset.dataset_id, title: dataset.title, finished_at: null }, quality));
  }
  sortQualityIssues(issues);
  return { issues, total: issues.length, coverage, legacyTables: { shown: page.datasets.length, total: page.total } };
}

/** Every issue in one list, following the cursor up to `QUALITY_ISSUE_PAGES` pages. */
export async function loadQualityOverview(signal?: AbortSignal): Promise<QualityOverview> {
  let first;
  try {
    first = await listQualityIssues({ limit: QUALITY_ISSUE_PAGE_SIZE }, signal);
  } catch (cause) {
    if (isNotFound(cause)) return loadPerTable(signal);
    throw cause;
  }
  const issues = [...first.issues];
  let cursor = first.next_cursor;
  for (let page = 1; cursor && page < QUALITY_ISSUE_PAGES; page += 1) {
    const next = await listQualityIssues({ limit: QUALITY_ISSUE_PAGE_SIZE, cursor }, signal);
    issues.push(...next.issues);
    cursor = next.next_cursor;
  }
  return { issues, total: first.total, coverage: first.coverage };
}

/**
 * Whether Builder can see a table at all — asked only for a table in the URL that no
 * issue row names, where "no issues" and "no such table" would otherwise look alike.
 */
export async function tableIsVisible(datasetId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await listQualityIssues({ datasetId, limit: 1 }, signal);
    return response.coverage.tables > 0;
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
  }
  // An older Builder: ask for the table itself.
  try {
    await getDataset(datasetId, signal);
    return true;
  } catch (cause) {
    if (isNotFound(cause)) return false;
    throw cause;
  }
}
