/**
 * Tables: each table by its current snapshot, its rows and the status axes that need
 * action (#525).
 *
 * The list reads like a warehouse, not a build console: no stage summary or validation
 * filter. Every cell is a contract field or `—`. Without a warehouse the snapshot
 * columns have nothing to show, so they are hidden and one line says why.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AxisValue, actionableAxes, type Axis } from "@/features/datasets/components/StatusAxes";
import { formatDateTime, uniqueProviders } from "@/features/datasets/model";
import { loadTableList, type SourceSnapshot, type TableList, type TableListRow } from "@/features/datasets/tableList";
import { i18n } from "@/shared/i18n";
import { Button, Card, EmptyState, ErrorState, LinkButton, PageHeader, SkeletonTable, TextInput } from "@/shared/ui";
import { cn } from "@/shared/ui/cn";
import { MissingStatus, NotEvaluatedStatus } from "@/shared/ui/StatusState";

interface ListState {
  status: "loading" | "loaded" | "error";
  list?: TableList;
  error?: string;
}

const selectClassName =
  "h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The axes shown as columns. Access is shown under the table name, only when it needs action. */
const AXIS_COLUMNS: Axis[] = ["health", "completeness", "refresh"];

/** A column that only fits from `sm` up. */
const WIDE_ONLY = "hidden sm:table-cell";

export function DatasetCatalogPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<ListState>({ status: "loading" });

  const load = useCallback(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    loadTableList(controller.signal)
      .then((list) => setState({ status: "loaded", list }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: cause instanceof Error ? cause.message : i18n.t("catalog.errors.list") });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  const query = searchParams.get("q") ?? "";
  const provider = searchParams.get("provider") ?? "";
  const attentionOnly = searchParams.get("attention") === "1";
  const rows = useMemo(() => state.list?.rows ?? [], [state.list]);
  const warehouse = state.list?.warehouse ?? false;

  function updateParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next);
  }

  const providerOptions = useMemo(() => uniqueProviders(rows.flatMap((row) => row.sources)), [rows]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        row.dataset_id.toLocaleLowerCase().includes(normalizedQuery) ||
        row.title.toLocaleLowerCase().includes(normalizedQuery) ||
        row.sources.some((source) => `${source.provider} ${source.dataset} ${source.alias}`.toLocaleLowerCase().includes(normalizedQuery));
      const matchesProvider = !provider || row.sources.some((source) => source.provider === provider);
      const matchesAttention = !attentionOnly || actionableAxes(row.status_axes).length > 0;
      return matchesQuery && matchesProvider && matchesAttention;
    });
  }, [rows, query, provider, attentionOnly]);

  function openTable(datasetId: string) {
    navigate(`/tables/${encodeURIComponent(datasetId)}`);
  }

  // Below `sm` only the key columns stay: the table, its current snapshot, and the status
  // (drawn under the table name). The rest scrolls nowhere — it is simply not shown (#573).
  const headers: { label: string; className?: string }[] = [
    { label: t("catalog.columns.table") },
    ...(warehouse
      ? [
          { label: t("catalog.columns.snapshot") },
          { label: t("catalog.columns.rows"), className: `${WIDE_ONLY} text-right` },
        ]
      : []),
    ...AXIS_COLUMNS.map((axis) => ({ label: t(`statusAxes.axis.${axis}`), className: WIDE_ONLY })),
    { label: t("catalog.columns.lastRefreshed"), className: WIDE_ONLY },
  ];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader title={t("nav.datasets")} description={t("catalog.page.desc")} actions={<LinkButton to="/add">{t("tableActions.create")}</LinkButton>} />

      <Card className="min-w-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1 basis-56 lg:max-w-[390px]">
            <label htmlFor="dataset-search" className="sr-only">
              {t("catalog.searchLabel")}
            </label>
            <TextInput id="dataset-search" placeholder={t("catalog.searchPlaceholder")} value={query} onChange={(event) => updateParam("q", event.target.value)} />
          </div>
          <label className="min-w-36 flex-1 sm:flex-none">
            <span className="sr-only">Provider</span>
            <select aria-label="Provider" className={`w-full ${selectClassName}`} value={provider} onChange={(event) => updateParam("provider", event.target.value)}>
              <option value="">{t("catalog.allProviders")}</option>
              {providerOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex h-9 items-center gap-2 text-sm text-foreground">
            <input checked={attentionOnly} className="h-4 w-4" onChange={(event) => updateParam("attention", event.target.checked ? "1" : "")} type="checkbox" />
            {t("catalog.attentionOnly")}
          </label>
        </div>

        {state.status === "loaded" && !warehouse ? (
          <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{t("catalog.noWarehouse")}</p>
        ) : null}

        {state.status === "loading" ? (
          <SkeletonTable rows={5} className="w-full" />
        ) : state.status === "error" ? (
          <ErrorState title={t("catalog.errors.listTitle")} message={state.error} onRetry={load} />
        ) : visibleRows.length === 0 ? (
          <EmptyState title={t("catalog.noMatch.title")} description={t("catalog.noMatch.desc")} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-left sm:min-w-[760px] text-[13px] leading-[18px]">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {headers.map((header) => (
                    <th className={cn("px-4 py-2 font-medium", header.className)} key={header.label} scope="col">
                      {header.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.dataset_id}
                    role="link"
                    tabIndex={0}
                    aria-label={t("catalog.openDetail", { title: row.title })}
                    className="cursor-pointer border-b border-border align-top transition last:border-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => openTable(row.dataset_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openTable(row.dataset_id);
                      }
                    }}
                  >
                    <td className="px-4 py-2">
                      <p className="break-all font-mono text-foreground sm:break-normal">{row.dataset_id}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.title} · {uniqueProviders(row.sources).join(", ")}
                      </p>
                      <RowStatus axes={row.status_axes} />
                    </td>
                    {warehouse ? (
                      <>
                        <td className="px-4 py-2">
                          <PerSource row={row} render={(entry) => <SnapshotId entry={entry} />} />
                        </td>
                        <td className={cn(WIDE_ONLY, "px-4 py-2 text-right tabular-nums")}>
                          <PerSource row={row} render={(entry) => <RowCount entry={entry} />} />
                        </td>
                      </>
                    ) : null}
                    {AXIS_COLUMNS.map((axis) => (
                      <td className={cn(WIDE_ONLY, "whitespace-nowrap px-4 py-2")} key={axis}>
                        <AxisValue axes={row.status_axes} axis={axis} />
                      </td>
                    ))}
                    <td className={cn(WIDE_ONLY, "whitespace-nowrap px-4 py-2 text-muted-foreground")}>
                      {warehouse ? (
                        <PerSource row={row} render={(entry) => <CommittedAt entry={entry} />} />
                      ) : row.updated_at ? (
                        formatDateTime(row.updated_at)
                      ) : (
                        <MissingStatus />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.status === "loaded" ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>{t("catalog.shownCount", { count: visibleRows.length })}</span>
            {query || provider || attentionOnly ? (
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                {t("catalog.resetFilters")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </main>
  );
}

/**
 * The status under a table's name. Access has no column, so an access that needs action
 * is always here. Below `sm`, where the axis columns are hidden, every axis that needs
 * action is here too — or, when none does, the health axis as quiet text — so a narrow
 * screen still shows each table's status without scrolling (#573).
 */
function RowStatus({ axes }: { axes: TableListRow["status_axes"] }) {
  const { t } = useTranslation();
  const actionable = actionableAxes(axes);
  if (actionable.length === 0) {
    return (
      <p className="mt-1 text-xs sm:hidden">
        <span className="mr-1 text-muted-foreground">{t("statusAxes.axis.health")}</span>
        <AxisValue axes={axes} axis="health" />
      </p>
    );
  }
  return (
    <ul className={cn("mt-1 flex flex-wrap gap-1", !actionable.includes("access") && "sm:hidden")}>
      {actionable.map((axis) => (
        <li className={axis === "access" ? undefined : "sm:hidden"} key={axis}>
          <AxisValue axes={axes} axis={axis} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One line per source table. A dataset with one source shows the value alone; with
 * several, each line is prefixed by its source key so the values are never summed.
 * A dataset the warehouse has no table for yet shows `—`.
 */
function PerSource({ row, render }: { row: TableListRow; render: (entry: SourceSnapshot) => ReactNode }) {
  const entries = row.snapshots ?? [];
  if (entries.length === 0) return <MissingStatus />;
  if (entries.length === 1) return <>{render(entries[0])}</>;
  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.logicalName}>
          <span className="mr-1 break-all font-mono text-[11px] text-muted-foreground sm:break-normal">{entry.sourceKey}</span>
          {render(entry)}
        </li>
      ))}
    </ul>
  );
}

function SnapshotId({ entry }: { entry: SourceSnapshot }) {
  const { t } = useTranslation();
  if (entry.current === null) return <NotEvaluatedStatus>{t("catalog.notCommitted")}</NotEvaluatedStatus>;
  if (entry.current === undefined) return <MissingStatus />;
  return <span className="font-mono">{entry.current.snapshot_id}</span>;
}

function RowCount({ entry }: { entry: SourceSnapshot }) {
  const count = entry.current?.row_count;
  if (count === null || count === undefined) return <MissingStatus />;
  return <span>{count.toLocaleString("ko-KR")}</span>;
}

function CommittedAt({ entry }: { entry: SourceSnapshot }) {
  const committedAt = entry.current?.committed_at;
  if (!committedAt) return <MissingStatus />;
  return <span>{formatDateTime(committedAt)}</span>;
}
