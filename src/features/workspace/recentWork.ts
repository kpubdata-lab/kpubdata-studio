/**
 * Recent Work composition helper (#260).
 *
 * Merges Datasets/Builds (Builder lookups) with Reports/Saved BuildSpecs
 * 합치되, 종류·출처(Builder vs 이 브라우저)·정확한 이동 경로를 각 항목에 명시적으로
 * 태그해 화면이 서로 다른 자산을 뭉뚱그리지 않게 한다. 순수 함수라 Builder 응답이나
 * localStorage를 직접 다루지 않는다 — 호출부가 이미 로드한 데이터를 넘겨준다.
 */
import type { DatasetSummary } from "@/shared/lib/builderApi";
import type { BuildListItem } from "@/shared/lib/types";
import type { ReportSummary } from "@/features/reports/types";
import type { SavedBuildSpecSummary } from "./types";

export type RecentWorkKind = "dataset" | "build" | "report" | "savedSpec";

export interface RecentWorkItem {
  kind: RecentWorkKind;
  id: string;
  title: string;
  /** Where it is stored — so the screen can badge "Builder" vs "this browser". */
  source: "builder" | "local";
  /** Sort-key timestamp; null when unknown (never guessed) — goes to the end. */
  timestamp: string | null;
  /** Exact ID-based destination; never inferred from title/order. */
  href: string;
}

function toMillis(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Build sort-key timestamp: prefers the start time, falls back to the end time. */
function buildTimestamp(build: BuildListItem): string | null {
  return build.startedAt ?? build.finishedAt ?? null;
}

export interface RecentWorkSource {
  datasets: DatasetSummary[];
  builds: BuildListItem[];
  reports: ReportSummary[];
  savedSpecs: SavedBuildSpecSummary[];
}

/**
 * Merges the four source lists into `RecentWorkItem[]`, sorted by timestamp descending (newest first).
 * Items without timestamps go last, keeping their original relative order (stable sort).
 */
export function toRecentWorkItems(source: RecentWorkSource): RecentWorkItem[] {
  const items: RecentWorkItem[] = [
    ...source.datasets.map(
      (dataset): RecentWorkItem => ({
        kind: "dataset",
        id: dataset.dataset_id,
        title: dataset.title,
        source: "builder",
        timestamp: dataset.updated_at,
        href: `/datasets/${encodeURIComponent(dataset.dataset_id)}`,
      }),
    ),
    ...source.builds.map(
      (build): RecentWorkItem => ({
        kind: "build",
        id: build.id,
        title: build.title ?? build.id,
        source: "builder",
        timestamp: buildTimestamp(build),
        href: `/builds/${encodeURIComponent(build.id)}`,
      }),
    ),
    ...source.reports.map(
      (report): RecentWorkItem => ({
        kind: "report",
        id: report.id,
        title: report.title,
        source: "local",
        timestamp: report.updatedAt,
        href: `/reports/${encodeURIComponent(report.id)}`,
      }),
    ),
    ...source.savedSpecs.map(
      (spec): RecentWorkItem => ({
        kind: "savedSpec",
        id: spec.id,
        title: spec.name,
        source: "local",
        timestamp: spec.updatedAt,
        href: `/builds/new?savedSpecId=${encodeURIComponent(spec.id)}`,
      }),
    ),
  ];

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = toMillis(b.item.timestamp) - toMillis(a.item.timestamp);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ item }) => item);
}

/** Max Recent Work items shown at once; the rest live on their section pages. */
export const RECENT_WORK_DISPLAY_LIMIT = 10;
