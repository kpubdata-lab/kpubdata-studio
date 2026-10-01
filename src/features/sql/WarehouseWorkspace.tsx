/**
 * SQL Workspace over committed warehouse tables (#417).
 *
 * Pick a table in the explorer (#528) and a snapshot — `current` by default, resolved by
 * the Builder when the query starts — and run it yourself. The binding bar names what
 * `dataset` reads; the explorer only edits the SQL, it never runs it. The result names the snapshot it read. Saving
 * runs the query once more through `POST /analyses`, which stores that concrete
 * snapshot id, so the saved analysis re-runs on the same input after a refresh.
 *
 * `?table=&snapshot=&analysis=` keeps the target in the URL; `analysis` loads a saved
 * analysis's SQL and binding (from Saved Analyses' "open in SQL Workspace").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { AggregateChartPanel } from "@/features/charts/AggregateChartPanel";
import { TableRowsPanel } from "@/features/data-table/TableRowsPanel";
import { ExportHistory } from "@/features/export/ExportHistory";
import { ExportPanel } from "@/features/export/ExportPanel";
import { type QueryResponse, type WarehouseSnapshot, type WarehouseTable } from "@/shared/lib/builderApi";
import { warehouseApi } from "./warehouseApi";
import { Button, Card, PageHeader } from "@/shared/ui";

import { QueryError, ResultTable } from "./ResultTable";
import { coverageCounts, coverageOf } from "./snapshotCoverage";
import { TableExplorer } from "./TableExplorer";
import { referencedTableNames, sqlIdentifier } from "./tableReferences";
import { queryWarehouse, saveAnalysis, type Pinned, type WarehouseOutcome } from "./warehouse";

const DEFAULT_SQL = "SELECT *\nFROM dataset\nLIMIT 100";
const CURRENT = "current";

const fieldClassName =
  "mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/** `table@snapshot · rev N` — what a result read. */
export function pinnedLabel(table: string, snapshotId: string, revision?: number): string {
  return `${table}@${snapshotId}${revision === undefined ? "" : ` · rev ${revision}`}`;
}

/** The selected snapshot's coverage; for `current`, the table's current snapshot (#417). */
function SnapshotCoverageNote({ snapshot }: { snapshot: WarehouseSnapshot | undefined }) {
  const { t } = useTranslation();
  if (!snapshot) return null;
  const word = coverageOf(snapshot);
  const counts = coverageCounts(snapshot);
  return (
    <p
      className={`text-xs ${word === "complete" ? "text-muted-foreground" : "font-semibold text-status-warning"}`}
      data-coverage={word}
      data-testid="snapshot-coverage"
    >
      {t(`sql.coverage.${word}`, { snapshot: snapshot.snapshot_id })}
      {counts ? ` ${t("sql.coverage.counts", counts)}` : ""}
      {snapshot.coverage?.reasons.length ? ` (${snapshot.coverage.reasons.join(", ")})` : ""}
    </p>
  );
}

/**
 * `dataset → <table> @ <snapshot>` — what the relation `dataset` reads (#528). `dataset`
 * is the product's name for the bound table, not a limitation to hide.
 */
function BindingBar({ table, snapshot, currentId }: { table: string; snapshot: string; currentId: string | null }) {
  const { t } = useTranslation();
  const snapshotText = snapshot === CURRENT && table && currentId ? `${CURRENT} (${currentId})` : snapshot;
  return (
    <div
      className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs"
      data-testid="dataset-binding"
    >
      <span className="font-semibold text-muted-foreground">{t("sql.binding")}</span>
      <code className="min-w-0 break-all font-mono text-foreground">
        {`dataset → ${table || "—"}${table ? ` @ ${snapshotText}` : ""}`}
      </code>
    </div>
  );
}

/** Rows · time · snapshot · rev · LIMIT — only what the Builder and the request said (#528). */
function ResultFooter({ result, pinned }: { result: QueryResponse; pinned: Pinned }) {
  const { t } = useTranslation();
  const parts = [
    t("sql.rows", { count: result.rows.length }) + (result.truncated ? ` (${t("sql.truncated")})` : ""),
    `${result.execution_ms} ms`,
    `snapshot ${pinned.snapshotId}`,
    ...(pinned.revision === undefined ? [] : [`rev ${pinned.revision}`]),
    ...(pinned.limit === undefined ? [] : [`LIMIT ${pinned.limit}`]),
  ];
  return (
    <p className="break-all font-mono text-xs text-muted-foreground" data-testid="result-footer">
      {parts.join(" · ")}
    </p>
  );
}

export function WarehouseWorkspace({ tables }: { tables: WarehouseTable[] }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const table = params.get("table") ?? "";
  const snapshot = params.get("snapshot") ?? CURRENT;
  const analysisId = params.get("analysis");

  const [snapshots, setSnapshots] = useState<WarehouseSnapshot[] | null>(null);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"run" | "save" | null>(null);
  const [outcome, setOutcome] = useState<WarehouseOutcome | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [exportsVersion, setExportsVersion] = useState(0);

  const currentId = tables.find((item) => item.logical_name === table)?.current_snapshot_id ?? null;
  const selectedSnapshot = (snapshots ?? []).find((item) => item.snapshot_id === (snapshot === CURRENT ? currentId : snapshot));

  function update(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    setParams(merged, { replace: true });
  }

  useEffect(() => {
    if (!table) return;
    const controller = new AbortController();
    setSnapshots(null);
    warehouseApi()
      .getWarehouseTable(table, controller.signal)
      .then((detail) => setSnapshots(detail.snapshots))
      .catch(() => !controller.signal.aborted && setSnapshots([]));
    return () => controller.abort();
  }, [table]);

  // Opening a saved analysis: its SQL and name come from the Builder, not the URL.
  useEffect(() => {
    if (!analysisId) return;
    const controller = new AbortController();
    warehouseApi()
      .listAnalyses(controller.signal)
      .then(({ analyses }) => {
        const found = analyses.find((item) => item.analysis_id === analysisId);
        if (found) {
          setSql(found.sql);
          setName(found.name);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [analysisId]);

  const blocked = !table ? t("sql.needTable") : null;
  const tableNamesInFrom = useMemo(
    () => referencedTableNames(sql, tables.map((item) => item.logical_name)),
    [sql, tables],
  );

  function selectTable(next: string) {
    if (next !== table) update({ table: next, snapshot: null, analysis: null });
  }

  /** Put a column at the editor's cursor — and bind `dataset` to its table. Never runs. */
  function insertColumn(columnTable: string, column: string) {
    const text = sqlIdentifier(column);
    const editor = editorRef.current;
    const start = editor?.selectionStart ?? sql.length;
    const end = editor?.selectionEnd ?? sql.length;
    setSql((previous) => previous.slice(0, start) + text + previous.slice(end));
    selectTable(columnTable);
    requestAnimationFrame(() => editorRef.current?.setSelectionRange(start + text.length, start + text.length));
  }

  async function run() {
    if (blocked || !sql.trim()) return;
    setBusy("run");
    setOutcome(await queryWarehouse(table, snapshot, sql));
    setBusy(null);
  }

  async function save() {
    if (blocked || !sql.trim() || !name.trim()) return;
    setBusy("save");
    setOutcome(await saveAnalysis(name.trim(), table, snapshot, sql));
    setBusy(null);
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader
        title={t("sql.title")}
        description={t("sql.desc")}
        actions={
          <Button disabled={!!blocked || busy !== null || !sql.trim()} loading={busy === "run"} onClick={() => void run()}>
            {t("sql.run")}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[256px_minmax(0,1fr)]">
        <Card className="flex min-w-0 flex-col gap-3 p-4 text-sm">
          <TableExplorer
            onInsertColumn={insertColumn}
            onSelectTable={selectTable}
            selectedSnapshot={snapshot}
            selectedTable={table}
            tables={tables}
          />
          <label className="text-xs font-semibold text-muted-foreground">
            {t("sql.snapshotLabel")}
            <select
              aria-label={t("sql.snapshotLabel")}
              className={`font-mono ${fieldClassName}`}
              disabled={!table || snapshots === null}
              onChange={(event) => update({ snapshot: event.target.value === CURRENT ? null : event.target.value })}
              value={snapshot}
            >
              <option value={CURRENT}>{t("sql.currentSnapshot")}</option>
              {(snapshots ?? []).map((item) => (
                <option disabled={item.state !== "committed"} key={item.snapshot_id} value={item.snapshot_id}>
                  {item.snapshot_id}
                  {item.row_count === null ? "" : ` · ${t("sql.rows", { count: item.row_count })}`}
                  {` · ${t(`statusAxes.value.completeness.${coverageOf(item)}`)}`}
                  {item.state === "committed" ? "" : ` · ${item.state}`}
                </option>
              ))}
            </select>
          </label>
          <SnapshotCoverageNote snapshot={selectedSnapshot} />
          <p className="text-xs text-muted-foreground">{t("sql.currentNote")}</p>
          <p className="text-xs text-muted-foreground">{t("sql.oneTable")}</p>
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          <BindingBar currentId={currentId} snapshot={snapshot} table={table} />
          <label className="sr-only" htmlFor="sql-editor">
            {t("sql.editor")}
          </label>
          <textarea
            className="min-h-48 w-full rounded-lg border border-input bg-card p-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="sql-editor"
            onChange={(event) => setSql(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void run();
            }}
            ref={editorRef}
            spellCheck={false}
            value={sql}
          />
          {tableNamesInFrom.length > 0 ? (
            <p className="rounded-lg border border-status-warning-border bg-status-warning-subtle px-3 py-2 text-xs text-status-warning" role="note">
              {t("sql.tableInFrom", { names: tableNamesInFrom.join(", ") })}
            </p>
          ) : null}
          {blocked ? <p className="text-xs text-muted-foreground">{blocked}</p> : null}

          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1 text-xs font-semibold text-muted-foreground">
              {t("analyses.nameLabel")}
              <input
                className={fieldClassName}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("analyses.namePlaceholder")}
                value={name}
              />
            </label>
            <Button
              disabled={!!blocked || busy !== null || !sql.trim() || !name.trim()}
              loading={busy === "save"}
              onClick={() => void save()}
              variant="secondary"
            >
              {t("analyses.save")}
            </Button>
          </div>

          {table ? <TableRowsPanel key={`${table}@${snapshot}`} snapshot={snapshot} table={table} /> : null}
          {table ? <AggregateChartPanel key={`chart-${table}@${snapshot}`} snapshot={snapshot} table={table} /> : null}
          {table && !blocked ? (
            <ExportPanel
              key={`export-${table}@${snapshot}`}
              onCreated={() => setExportsVersion((value) => value + 1)}
              snapshot={snapshot}
              sql={sql}
              table={table}
            />
          ) : null}
          <ExportHistory refreshKey={exportsVersion} />

          {outcome?.status === "error" ? <QueryError code={outcome.code} message={outcome.message} /> : null}
          {outcome?.status === "success" ? (
            <>
              {outcome.saved ? (
                <p className="text-sm" role="status">
                  {t("analyses.saved", { name: outcome.saved.name })}{" "}
                  <Link className="font-medium text-brand-text underline" to="/analyses">
                    {t("analyses.openList")}
                  </Link>
                </p>
              ) : null}
              <ResultTable
                result={outcome.result}
                target={pinnedLabel(outcome.pinned.table, outcome.pinned.snapshotId, outcome.pinned.revision)}
              />
              <ResultFooter pinned={outcome.pinned} result={outcome.result} />
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
