/**
 * `GET /quality/issues` rows from one table's latest-run quality (kpubdata-builder#843).
 *
 * Used where Studio has only the per-run `GET /builds/{run_id}/quality`: the demo, and
 * a KPubData Builder older than contract 1.49.0. The rows are the run's WARN/FAIL
 * results and drift findings as they are — nothing is judged here — and the table is
 * put in the same coverage bucket Builder would use.
 */
import type {
  BuildQualityResponse,
  QualityIssue,
  QualityIssuesCoverage,
} from "@/shared/lib/builderApi";

const ISSUE_ORDER: Record<QualityIssue["status"], number> = { fail: 0, warn: 1, drift: 2 };

export function emptyQualityCoverage(): QualityIssuesCoverage {
  return { tables: 0, evaluated: 0, not_evaluated: 0, partial: 0, unreadable: 0 };
}

/** The coverage bucket of a table whose latest-run quality was read. */
export function qualityCoverageBucket(quality: BuildQualityResponse): "evaluated" | "not_evaluated" | "partial" {
  if (quality.availability === "partial") return "partial";
  if (quality.availability === "unavailable" || quality.evaluated_checks === 0) return "not_evaluated";
  return "evaluated";
}

export function issuesFromRunQuality(
  table: { dataset_id: string; title: string | null; finished_at: string | null },
  quality: BuildQualityResponse,
): QualityIssue[] {
  const base = { ...table, run_id: quality.run_id };
  const rows: QualityIssue[] = [];
  for (const [sourceKey, results] of Object.entries(quality.quality_results)) {
    for (const check of results) {
      if (check.status === "pass") continue;
      rows.push({ ...base, source_key: sourceKey, kind: "check", status: check.status, category: check.category, check, drift: null });
    }
  }
  for (const [sourceKey, findings] of Object.entries(quality.schema_drift)) {
    for (const drift of findings) {
      rows.push({ ...base, source_key: sourceKey, kind: "drift", status: "drift", category: "schema_drift", check: null, drift });
    }
  }
  return rows;
}

/** Builder's order: fail, warn, drift, then by table, source and rule. */
export function sortQualityIssues(rows: QualityIssue[]): QualityIssue[] {
  return rows.sort(
    (a, b) =>
      ISSUE_ORDER[a.status] - ISSUE_ORDER[b.status] ||
      a.dataset_id.localeCompare(b.dataset_id) ||
      a.source_key.localeCompare(b.source_key) ||
      (a.check?.rule ?? "").localeCompare(b.check?.rule ?? ""),
  );
}
