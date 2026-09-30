/**
 * Quality Center page (`/quality`, #254, #536).
 *
 * Workspace-wide: one table of what needs attention in every table's latest refresh —
 * WARN and FAIL results and schema drift — filtered by Status, Table and Category. The
 * deep dive into one table (its runs, sources, stages, trend) is Table Detail's Quality
 * tab; every row links there.
 *
 * Displays only actual evaluated quality results returned by Builder; Studio doesn't
 * create scores or re-judge PASS/WARN/FAIL (#246). A table with nothing evaluated is
 * "not evaluated" (N/A), never counted as passed, and a table whose quality could not be
 * read is said so, never shown as clean.
 *
 * Filters live in the URL (`?status=&dataset=&category=`); `dataset` keeps its name so
 * Ask KPubData's context and older links (`?dataset=&run=`) still resolve. A `run` that
 * is not the table's latest points to that run in Table Detail instead.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { QualityIssuesTable } from "@/features/quality/QualityIssuesTable";
import {
  DRIFT_CATEGORY,
  collectIssues,
  issueCategory,
  issueStatus,
  loadQualityOverview,
  qualityCoverage,
  type IssueStatus,
  type QualityOverview,
} from "@/features/quality/issues";
import { qualityAssistantSeedQuestion, summarizeChecksPassed } from "@/features/quality/model";
import { useUIStore } from "@/shared/hooks/useUIStore";
import type { DatasetSummary } from "@/shared/lib/builderApi";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "loaded"; overview: QualityOverview };

const STATUSES: IssueStatus[] = ["fail", "warn", "drift"];

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TableLinks({ datasets }: { datasets: DatasetSummary[] }) {
  return (
    <>
      {datasets.map((dataset, index) => (
        <span key={dataset.dataset_id}>
          {index > 0 ? ", " : null}
          <Link
            className="text-accent-subtle-foreground underline-offset-2 hover:underline"
            to={`/tables/${encodeURIComponent(dataset.dataset_id)}?tab=quality`}
          >
            {dataset.title}
          </Link>
        </span>
      ))}
    </>
  );
}

export function QualityPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);
  const seedAssistantQuestion = useAssistantStore((state) => state.seedQuestion);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    loadQualityOverview(controller.signal)
      .then((overview) => setState({ status: "loaded", overview }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => controller.abort();
  }, []);

  const tables = useMemo(() => (state.status === "loaded" ? state.overview.tables : []), [state]);
  const issues = useMemo(() => collectIssues(tables), [tables]);
  const coverage = useMemo(() => qualityCoverage(tables), [tables]);
  const categories = useMemo(() => {
    const found = new Set(issues.map(issueCategory));
    return [...found].sort((a, b) => (a === DRIFT_CATEGORY ? 1 : b === DRIFT_CATEGORY ? -1 : a.localeCompare(b)));
  }, [issues]);

  const requestedStatus = searchParams.get("status");
  const statusFilter = STATUSES.includes(requestedStatus as IssueStatus) ? (requestedStatus as IssueStatus) : "";
  const datasetFilter = searchParams.get("dataset") ?? "";
  const categoryFilter = searchParams.get("category") ?? "";
  const legacyRun = searchParams.get("run");
  const filteredTable = tables.find((table) => table.dataset.dataset_id === datasetFilter)?.dataset;
  const invalidDataset = Boolean(datasetFilter && state.status === "loaded" && !filteredTable);

  const visible = issues.filter(
    (row) =>
      (!statusFilter || issueStatus(row) === statusFilter) &&
      (!datasetFilter || row.dataset.dataset_id === datasetFilter) &&
      (!categoryFilter || issueCategory(row) === categoryFilter),
  );

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // A table filter change drops an older link's run/source/stage scope.
    if (key === "dataset") ["run", "source", "stage"].forEach((param) => next.delete(param));
    setSearchParams(next);
  }

  const header = (
    <PageHeader
      title={t("quality.page.title")}
      meta={state.status === "loaded" ? t("quality.page.meta", { count: tables.length }) : undefined}
      description={t("quality.header.desc")}
      actions={
        state.status === "loaded" ? (
          <Button
            variant="secondary"
            onClick={() => {
              const results = tables.flatMap((table) => (table.status === "loaded" ? Object.values(table.quality.quality_results).flat() : []));
              seedAssistantQuestion(qualityAssistantSeedQuestion(summarizeChecksPassed(results)));
              openAssistantDrawer();
            }}
          >
            {t("quality.assistantAnalyze")}
          </Button>
        ) : undefined
      }
    />
  );
  const main = "flex flex-1 flex-col gap-4 px-5 py-7 sm:px-8 lg:px-10 lg:py-8";

  if (state.status === "loading") {
    return (
      <main className={main}>
        {header}
        <p className="sr-only" role="status">{t("quality.loading")}</p>
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className={main}>
        {header}
        <ErrorState title={t("quality.errors.datasets")} message={state.message} />
      </main>
    );
  }

  if (tables.length === 0) {
    return (
      <main className={main}>
        {header}
        <Card><EmptyState title={t("quality.empty.title")} description={t("quality.empty.desc")} actionLabel={t("quality.empty.action")} actionHref="/add" /></Card>
      </main>
    );
  }

  const total = state.overview.total;
  const legacyRunIsOlder = Boolean(legacyRun && filteredTable && legacyRun !== filteredTable.latest_run_id);

  return (
    <main className={main}>
      {header}

      <p className="text-sm text-muted-foreground" data-testid="quality-coverage">
        {t("quality.coverage.line", {
          tables: tables.length,
          issues: coverage.withIssues.length,
          passed: coverage.passed.length,
          notEvaluated: coverage.notEvaluated.length,
          failed: coverage.failed.length,
        })}
        {total !== undefined && total > tables.length ? ` ${t("quality.coverage.more", { shown: tables.length, total })}` : null}
      </p>

      {legacyRunIsOlder && filteredTable ? (
        <p className="text-sm" role="note">
          {t("quality.legacyRun.text", { run: legacyRun })}{" "}
          <Link
            className="text-accent-subtle-foreground underline"
            to={`/tables/${encodeURIComponent(filteredTable.dataset_id)}?${new URLSearchParams({
              run: legacyRun ?? "",
              ...(searchParams.get("source") ? { source: searchParams.get("source") ?? "" } : {}),
              tab: "quality",
            }).toString()}`}
          >
            {t("quality.legacyRun.link")}
          </Link>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-muted-foreground">
          {t("quality.filters.status")}
          <select aria-label={t("quality.filters.status")} className={`mt-1 ${selectClassName}`} onChange={(event) => setFilter("status", event.target.value)} value={statusFilter}>
            <option value="">{t("quality.filters.allStatuses")}</option>
            <option value="fail">FAIL</option>
            <option value="warn">WARN</option>
            <option value="drift">{t("quality.issues.drift")}</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t("quality.filters.table")}
          <select aria-label={t("quality.filters.table")} className={`mt-1 ${selectClassName}`} onChange={(event) => setFilter("dataset", event.target.value)} value={invalidDataset ? "" : datasetFilter}>
            <option value="">{t("quality.filters.allTables")}</option>
            {tables.map((table) => (
              <option key={table.dataset.dataset_id} value={table.dataset.dataset_id}>
                {table.dataset.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t("quality.filters.category")}
          <select aria-label={t("quality.filters.category")} className={`mt-1 ${selectClassName}`} onChange={(event) => setFilter("category", event.target.value)} value={categoryFilter}>
            <option value="">{t("quality.filters.allCategories")}</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category === DRIFT_CATEGORY ? t("quality.issues.drift") : category}
              </option>
            ))}
          </select>
        </label>
      </div>

      {invalidDataset ? (
        <p className="text-sm text-status-failure" role="alert">
          {t("quality.wrongDataset.desc", { id: datasetFilter })}{" "}
          <Button onClick={() => setFilter("dataset", "")} size="sm" variant="secondary">
            {t("quality.wrongDataset.back")}
          </Button>
        </p>
      ) : issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("quality.issues.none")}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("quality.issues.noneFiltered")}</p>
      ) : (
        <QualityIssuesTable rows={visible} />
      )}

      {coverage.partial.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("quality.coverage.partial")} <TableLinks datasets={coverage.partial} />
        </p>
      ) : null}
      {coverage.notEvaluated.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("quality.coverage.notEvaluated")} <TableLinks datasets={coverage.notEvaluated} />
        </p>
      ) : null}
      {coverage.failed.length > 0 ? (
        <p className="text-sm text-status-failure" role="alert">
          {t("quality.coverage.failed")} <TableLinks datasets={coverage.failed} />
        </p>
      ) : null}
    </main>
  );
}
