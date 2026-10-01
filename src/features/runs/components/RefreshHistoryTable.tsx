/**
 * Refresh history as one table (#535): Run ID, Table, Status, Started, Duration and
 * Snapshot, one row per run from `GET /builds`.
 *
 * Since kpubdata-builder#844 each run names the table it refreshed (`dataset_title`,
 * `dataset_id`) and the snapshot it committed (`snapshot_id`, or `snapshots` when it
 * committed several). An older Builder omits them and the cells stay `—` with the reason;
 * a run that committed nothing reads "None" — nothing is guessed. Duration is finished
 * minus started, and `—` when either is missing. The run id is the keyboard path to the detail; clicking
 * anywhere on the row does the same with a pointer.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { formatDateTime } from "@/features/datasets/model";
import type { BuildListItem } from "@/shared/lib/types";
import { StatusBadge, cn } from "@/shared/ui";
import { MissingStatus, NormalStatus } from "@/shared/ui/StatusState";

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground", className)} scope="col">
      {children}
    </th>
  );
}

/** Whole seconds between the two timestamps, or null when either is missing or unreadable. */
export function durationSeconds(item: Pick<BuildListItem, "startedAt" | "finishedAt">): number | null {
  if (!item.startedAt || !item.finishedAt) return null;
  const seconds = (new Date(item.finishedAt).getTime() - new Date(item.startedAt).getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

export function refreshDetailHref(runId: string): string {
  return `/refresh-jobs/${encodeURIComponent(runId)}`;
}

/** Table Detail of the run's table. */
export function tableHref(datasetId: string): string {
  return `/tables/${encodeURIComponent(datasetId)}`;
}

function TableCell({ item }: { item: BuildListItem }) {
  const { t } = useTranslation();
  const datasetId = item.datasetId ?? null;
  if (datasetId === null) {
    if (item.title) return <span className="text-foreground">{item.title}</span>;
    return (
      <MissingStatus
        label={item.datasetId === undefined ? t("builds.table.tableMissing") : t("builds.table.tableUnreadable")}
      />
    );
  }
  return (
    <div className="min-w-0">
      <Link
        className="text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => event.stopPropagation()}
        to={tableHref(datasetId)}
      >
        {item.title ?? <span className="font-mono text-xs">{datasetId}</span>}
      </Link>
      {item.title ? <p className="break-all font-mono text-xs text-muted-foreground">{datasetId}</p> : null}
    </div>
  );
}

function SnapshotCell({ item }: { item: BuildListItem }) {
  const { t } = useTranslation();
  if (item.snapshotId) return <span className="break-all font-mono text-xs text-foreground">{item.snapshotId}</span>;
  const committed = item.snapshots ?? [];
  if (committed.length > 0) {
    return (
      <ul aria-label={t("builds.table.snapshotsCount", { count: committed.length })} className="flex flex-col gap-0.5">
        {committed.map((entry) => (
          <li className="break-all font-mono text-xs" key={`${entry.logicalName}@${entry.snapshotId}`}>
            <span className="text-foreground">{entry.snapshotId}</span>{" "}
            <span className="text-muted-foreground">{entry.logicalName}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (item.snapshotId === undefined) return <MissingStatus label={t("builds.table.snapshotMissing")} />;
  // Builder said the run committed no snapshot that still exists: a known "none".
  return (
    <NormalStatus className="text-muted-foreground">
      <span title={t("builds.table.snapshotNoneHint")}>{t("builds.table.snapshotNone")}</span>
    </NormalStatus>
  );
}

export function RefreshHistoryTable({ items }: { items: BuildListItem[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const caption = t("builds.table.caption");
  return (
    // Wider than a phone: the table scrolls inside this region, never the page.
    <div
      aria-label={caption}
      className="relative max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <Th>{t("builds.table.runId")}</Th>
            <Th>{t("builds.table.table")}</Th>
            <Th>{t("builds.table.status")}</Th>
            <Th>{t("builds.table.started")}</Th>
            <Th className="text-right">{t("builds.table.duration")}</Th>
            <Th>{t("builds.table.snapshot")}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const seconds = durationSeconds(item);
            return (
              <tr
                className="cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40"
                key={item.id}
                // Pointer convenience; the run id link is the keyboard path.
                onClick={() => navigate(refreshDetailHref(item.id))}
              >
                <td className="px-3 py-2">
                  <Link
                    className="break-all font-mono text-xs text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => event.stopPropagation()}
                    to={refreshDetailHref(item.id)}
                  >
                    {item.id}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <TableCell item={item} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={item.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {item.startedAt ? formatDateTime(item.startedAt) : <MissingStatus />}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {seconds === null ? <MissingStatus /> : t("builds.table.seconds", { count: seconds })}
                </td>
                <td className="px-3 py-2">
                  <SnapshotCell item={item} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
