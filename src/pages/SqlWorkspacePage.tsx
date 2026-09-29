/**
 * SQL Workspace — the person queries a table snapshot (#417).
 *
 * Separate from Ask KPubData on purpose: the assistant may suggest SQL, but running
 * it is the person's act, and this screen says so. Every result names the snapshot
 * it read (table @ run · stage), so a number can be traced back after the table is
 * refreshed. One table per query until KPubData Engine joins tables
 * (kpubdata-builder#704); saving an analysis waits for server storage
 * (kpubdata-builder#783) — a browser-only save would be lost on another device.
 *
 * The selection lives in the URL (`?table=&run=&stage=&source=`), so Table Detail can
 * link here and a link reproduces the same query target.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { listBuildStages, listDatasetRuns, listDatasets } from "@/features/datasets/api";
import { runTableQuery, type QueryOutcome } from "@/features/sql/api";
import type { DatasetRunSummary, DatasetSummary } from "@/shared/lib/builderApi";
import { Button, Card, PageHeader, Skeleton } from "@/shared/ui";
import { QueryError, ResultTable } from "@/features/sql/ResultTable";
import { detectWarehouse, type WarehouseAvailability } from "@/features/sql/warehouse";
import { WarehouseWorkspace } from "@/features/sql/WarehouseWorkspace";

const STAGES = ["gold", "silver"] as const;
type Stage = (typeof STAGES)[number];
const DEFAULT_SQL = "SELECT *\nFROM dataset\nLIMIT 100";

const selectClassName =
  "mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

type Load<T> = { status: "loading" } | { status: "error" } | { status: "loaded"; data: T };

/** Query one run's table directly — the path for a deployment without a warehouse. */
function RunWorkspace() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const table = params.get("table") ?? "";
  const requestedRun = params.get("run") ?? "";
  const stage: Stage = params.get("stage") === "silver" ? "silver" : "gold";
  const requestedSource = params.get("source") ?? "";

  const [tables, setTables] = useState<Load<DatasetSummary[]>>({ status: "loading" });
  const [runs, setRuns] = useState<Load<DatasetRunSummary[]> | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{ target: string; value: QueryOutcome } | null>(null);

  function update(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    setParams(merged, { replace: true });
  }

  useEffect(() => {
    const controller = new AbortController();
    listDatasets(100, controller.signal)
      .then((data) => setTables({ status: "loaded", data }))
      .catch(() => !controller.signal.aborted && setTables({ status: "error" }));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!table) return;
    const controller = new AbortController();
    setRuns({ status: "loading" });
    listDatasetRuns(table, 50, controller.signal)
      .then((data) => setRuns({ status: "loaded", data: data.runs }))
      .catch(() => !controller.signal.aborted && setRuns({ status: "error" }));
    return () => controller.abort();
  }, [table]);

  // Every run, not only successful ones: a run that failed on one source still holds the
  // other sources' tables. When a stage is not there, the Engine says so (artifact_unavailable).
  const runOptions = runs?.status === "loaded" ? runs.data : [];
  const run = requestedRun || runOptions[0]?.run_id || "";

  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    setSources([]);
    listBuildStages(run, controller.signal)
      .then((data) => setSources(data.sources.map((entry) => entry.source_key)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [run]);

  // A single-source run needs no source; a multi-source one must say which.
  const source = sources.length > 1 ? (sources.includes(requestedSource) ? requestedSource : "") : "";
  const target = useMemo(
    () => (table && run ? `${table}@${run} · ${stage}${source ? ` · ${source}` : ""}` : ""),
    [table, run, stage, source],
  );
  const blocked = !table ? t("sql.needTable") : !run ? t("sql.needRun") : sources.length > 1 && !source ? t("sql.needSource") : null;

  async function execute() {
    if (blocked || !sql.trim()) return;
    setRunning(true);
    const value = await runTableQuery({ dataset_id: table, run_id: run, stage, sql, ...(source ? { source } : {}) });
    setOutcome({ target, value });
    setRunning(false);
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader
        eyebrow="SQL"
        title={t("sql.title")}
        description={t("sql.desc")}
        actions={
          <Button disabled={!!blocked || running || !sql.trim()} loading={running} onClick={() => void execute()}>
            {t("sql.run")}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="flex flex-col gap-3 text-sm">
          <label className="text-xs font-semibold text-muted-foreground">
            {t("sql.table")}
            <select
              aria-label={t("sql.table")}
              className={selectClassName}
              disabled={tables.status !== "loaded"}
              onChange={(event) => update({ table: event.target.value, run: null, source: null })}
              value={table}
            >
              <option value="">{t("sql.pickTable")}</option>
              {tables.status === "loaded"
                ? tables.data.map((item) => (
                    <option key={item.dataset_id} value={item.dataset_id}>
                      {item.dataset_id}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <label className="text-xs font-semibold text-muted-foreground">
            {t("sql.snapshot")}
            <select
              aria-label={t("sql.snapshot")}
              className={selectClassName}
              disabled={!table || runs?.status !== "loaded"}
              onChange={(event) => update({ run: event.target.value, source: null })}
              value={run}
            >
              {runOptions.map((item, index) => (
                <option key={item.run_id} value={item.run_id}>
                  {item.run_id}
                  {index === 0 ? ` (${t("sql.latest")})` : ""}
                  {item.status === "ok" ? "" : ` · ${item.status}`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-muted-foreground">
            Stage
            <select
              aria-label="Stage"
              className={selectClassName}
              onChange={(event) => update({ stage: event.target.value })}
              value={stage}
            >
              {STAGES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          {sources.length > 1 ? (
            <label className="text-xs font-semibold text-muted-foreground">
              Source
              <select
                aria-label="Source"
                className={selectClassName}
                onChange={(event) => update({ source: event.target.value })}
                value={source}
              >
                <option value="">{t("sql.pickSource")}</option>
                {sources.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {tables.status === "error" || runs?.status === "error" ? (
            <p className="text-xs text-red-700 dark:text-red-300" role="alert">
              {t("sql.loadError")}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("sql.oneTable")}</p>
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          <label className="sr-only" htmlFor="sql-editor">
            {t("sql.editor")}
          </label>
          <textarea
            className="min-h-48 w-full rounded-lg border border-input bg-card p-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="sql-editor"
            onChange={(event) => setSql(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void execute();
            }}
            spellCheck={false}
            value={sql}
          />
          <p className="text-xs text-muted-foreground">
            {blocked ?? t("sql.fromDataset", { target })}
          </p>

          {outcome ? <Result outcome={outcome.value} target={outcome.target} /> : null}
          <p className="text-xs text-muted-foreground">{t("sql.saveLater")}</p>
        </div>
      </div>
    </main>
  );
}

function Result({ outcome, target }: { outcome: QueryOutcome; target: string }) {
  if (outcome.status === "error") return <QueryError code={outcome.code} message={outcome.message} />;
  return <ResultTable demo={outcome.demo} result={outcome.result} target={target} />;
}


/**
 * The SQL Workspace picks its path once: a deployment with a warehouse queries committed
 * tables and can save analyses; one without keeps querying runs directly.
 */
export function SqlWorkspacePage() {
  const [warehouse, setWarehouse] = useState<WarehouseAvailability>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void detectWarehouse(controller.signal).then((value) => {
      if (!controller.signal.aborted) setWarehouse(value);
    });
    return () => controller.abort();
  }, []);

  if (warehouse.status === "loading") {
    return (
      <main className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }
  return warehouse.status === "available" ? <WarehouseWorkspace tables={warehouse.tables} /> : <RunWorkspace />;
}

