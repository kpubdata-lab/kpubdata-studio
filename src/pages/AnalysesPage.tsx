/**
 * Saved Analyses (#417) — SQL kept with the snapshot it read.
 *
 * Each analysis stores a concrete snapshot id (builder#783), so "Run again" reads the
 * same input even after the table was refreshed; the result says which snapshot. A
 * deployment without a warehouse has nowhere to keep them, and says so.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@/features/datasets/model";
import { QueryError, ResultTable } from "@/features/sql/ResultTable";
import { pinnedLabel } from "@/features/sql/WarehouseWorkspace";
import { detectWarehouse, rerunAnalysis, type WarehouseOutcome } from "@/features/sql/warehouse";
import { builderApi, type SavedAnalysis } from "@/shared/lib/builderApi";
import { Button, Card, EmptyState, LinkButton, PageHeader, Skeleton } from "@/shared/ui";

type ListState =
  | { status: "loading" }
  | { status: "no_warehouse" }
  | { status: "error"; message: string }
  | { status: "loaded"; analyses: SavedAnalysis[] };

export function AnalysesPage() {
  const { t } = useTranslation();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [results, setResults] = useState<Record<string, WarehouseOutcome | "running">>({});

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const warehouse = await detectWarehouse(controller.signal);
      if (controller.signal.aborted) return;
      if (warehouse.status !== "available") return setList({ status: "no_warehouse" });
      try {
        const { analyses } = await builderApi.listAnalyses(controller.signal);
        setList({ status: "loaded", analyses });
      } catch (cause) {
        if (!controller.signal.aborted) setList({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => controller.abort();
  }, []);

  async function rerun(analysis: SavedAnalysis) {
    setResults((prev) => ({ ...prev, [analysis.analysis_id]: "running" }));
    const outcome = await rerunAnalysis(analysis.analysis_id);
    setResults((prev) => ({ ...prev, [analysis.analysis_id]: outcome }));
  }

  async function remove(analysis: SavedAnalysis) {
    if (!window.confirm(t("analyses.confirmDelete", { name: analysis.name }))) return;
    try {
      await builderApi.deleteAnalysis(analysis.analysis_id);
      setList((prev) =>
        prev.status === "loaded" ? { ...prev, analyses: prev.analyses.filter((a) => a.analysis_id !== analysis.analysis_id) } : prev,
      );
    } catch (cause) {
      setResults((prev) => ({
        ...prev,
        [analysis.analysis_id]: { status: "error", code: "delete_failed", message: cause instanceof Error ? cause.message : String(cause) },
      }));
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader title={t("analyses.title")} description={t("analyses.desc")} actions={<LinkButton to="/sql">{t("analyses.newQuery")}</LinkButton>} />

      {list.status === "loading" ? <Skeleton className="h-32 w-full" /> : null}
      {list.status === "no_warehouse" ? <Card variant="dashed" className="text-sm">{t("analyses.noWarehouse")}</Card> : null}
      {list.status === "error" ? (
        <Card role="alert" variant="error">
          {list.message}
        </Card>
      ) : null}
      {list.status === "loaded" && list.analyses.length === 0 ? (
        <EmptyState title={t("analyses.emptyTitle")} description={t("analyses.emptyDesc")} actionHref="/sql" actionLabel={t("analyses.newQuery")} />
      ) : null}

      {list.status === "loaded"
        ? list.analyses.map((analysis) => {
            const binding = analysis.bindings[0];
            const outcome = results[analysis.analysis_id];
            const openHref = `/sql?${new URLSearchParams({
              ...(binding ? { table: binding.table, snapshot: binding.snapshot_id } : {}),
              analysis: analysis.analysis_id,
            })}`;
            return (
              <Card className="flex flex-col gap-3" key={analysis.analysis_id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{analysis.name}</h2>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {binding ? pinnedLabel(binding.table, binding.snapshot_id) : "—"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("analyses.savedMeta", {
                        at: formatDateTime(analysis.result_meta.executed_at),
                        count: analysis.result_meta.row_count,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button loading={outcome === "running"} onClick={() => void rerun(analysis)} size="sm">
                      {t("analyses.rerun")}
                    </Button>
                    <LinkButton size="sm" to={openHref} variant="secondary">
                      {t("analyses.open")}
                    </LinkButton>
                    <Button onClick={() => void remove(analysis)} size="sm" variant="ghost">
                      {t("analyses.delete")}
                    </Button>
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">{analysis.sql}</pre>
                {outcome && outcome !== "running" && outcome.status === "error" ? <QueryError code={outcome.code} message={outcome.message} /> : null}
                {outcome && outcome !== "running" && outcome.status === "success" ? (
                  <ResultTable result={outcome.result} target={pinnedLabel(outcome.pinned.table, outcome.pinned.snapshotId, outcome.pinned.revision)} />
                ) : null}
              </Card>
            );
          })
        : null}
    </main>
  );
}
