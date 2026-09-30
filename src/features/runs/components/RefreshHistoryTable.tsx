/**
 * Refresh history as one table (#535): Run ID, Table, Status, Started, Duration and
 * Snapshot, one row per run from `GET /builds`.
 *
 * `GET /builds` returns run id, status and the two timestamps only. The table a run
 * refreshed and the snapshot it produced are not in it, so those cells are `—` with the
 * reason, never guessed (kpubdata-builder#844). Duration is finished minus started, and
 * `—` when either is missing. The run id is the keyboard path to the detail; clicking
 * anywhere on the row does the same with a pointer.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { formatDateTime } from "@/features/datasets/model";
import type { BuildListItem } from "@/shared/lib/types";
import { StatusBadge, cn } from "@/shared/ui";
import { MissingStatus } from "@/shared/ui/StatusState";

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
                    className="break-all font-mono text-xs text-accent-subtle-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => event.stopPropagation()}
                    to={refreshDetailHref(item.id)}
                  >
                    {item.id}
                  </Link>
                </td>
                <td className="px-3 py-2 text-foreground">
                  {item.title ?? <MissingStatus label={t("builds.table.tableMissing")} />}
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
                  <MissingStatus label={t("builds.table.snapshotMissing")} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
