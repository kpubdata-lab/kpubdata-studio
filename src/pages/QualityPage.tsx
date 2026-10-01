/**
 * Quality Center page (`/quality`, #254, #536, #568).
 *
 * Workspace-wide: one table of what needs attention in every table's latest refresh —
 * WARN and FAIL results and schema drift — filtered by Status, Table and Category. The
 * rows and the table coverage come from one KPubData Builder call, `GET /quality/issues`
 * (kpubdata-builder#843), instead of one quality request per table (still the fallback
 * for a Builder older than contract 1.49.0). The deep dive into
 * one table (its runs, sources, stages, trend) is Table Detail's Quality tab; every row
 * links there.
 *
 * Displays only actual evaluated quality results returned by Builder; Studio doesn't
 * create scores or re-judge PASS/WARN/FAIL (#246). Builder's coverage counts tables not
 * evaluated, partially evaluated and unreadable separately; none is counted as passed.
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
  issueCategory,
  issueStatus,
  issueTables,
  loadQualityOverview,
  tableIsVisible,
  type IssueStatus,
  type QualityOverview,
} from "@/features/quality/issues";
import { qualityAssistantSeedQuestion } from "@/features/quality/model";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "loaded"; overview: QualityOverview };

/** Whether Builder can see the table named in the URL, when no issue row names it. */
type Visibility = "unknown" | "visible" | "invisible";

const STATUSES: IssueStatus[] = ["fail", "warn", "drift"];

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function QualityPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);
  const seedAssistantQuestion = useAssistantStore((state) => state.seedQuestion);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [visibility, setVisibility] = useState<Visibility>("unknown");

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

  const issues = useMemo(() => (state.status === "loaded" ? state.overview.issues : []), [state]);
  const tables = useMemo(() => issueTables(issues), [issues]);
  const categories = useMemo(() => {
    const found = new Set(issues.map(issueCategory));
    return [...found].sort((a, b) => (a === DRIFT_CATEGORY ? 1 : b === DRIFT_CATEGORY ? -1 : a.localeCompare(b)));
  }, [issues]);

  const requestedStatus = searchParams.get("status");
  const statusFilter = STATUSES.includes(requestedStatus as IssueStatus) ? (requestedStatus as IssueStatus) : "";
  const datasetFilter = searchParams.get("dataset") ?? "";
  const categoryFilter = searchParams.get("category") ?? "";
  const legacyRun = searchParams.get("run");
  const filteredTable = tables.find((table) => table.datasetId === datasetFilter);
  const needsVisibilityCheck = Boolean(datasetFilter && state.status === "loaded" && !filteredTable);

  // A table in the URL that no issue names either has no issues or is not visible to this
  // account; one filtered call tells the two apart.
  useEffect(() => {
    setVisibility("unknown");
    if (!needsVisibilityCheck) return;
    const controller = new AbortController();
    tableIsVisible(datasetFilter, controller.signal)
      .then((visible) => {
        if (!controller.signal.aborted) setVisibility(visible ? "visible" : "invisible");
      })
      .catch(() => {
        // Unknown stays unknown: the filter then just finds no issues.
      });
    return () => controller.abort();
  }, [needsVisibilityCheck, datasetFilter]);
  const invalidDataset = needsVisibilityCheck && visibility === "invisible";

  const visible = issues.filter(
    (row) =>
      (!statusFilter || issueStatus(row) === statusFilter) &&
      (!datasetFilter || row.dataset_id === datasetFilter) &&
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

  const coverage = state.status === "loaded" ? state.overview.coverage : null;
  const header = (
    <PageHeader
      title={t("quality.page.title")}
      meta={coverage ? t("quality.page.meta", { count: coverage.tables }) : undefined}
      description={t("quality.header.desc")}
      actions={
        coverage ? (
          <Button
            variant="secondary"
            onClick={() => {
              const fail = issues.filter((row) => row.status === "fail").length;
              const warn = issues.filter((row) => row.status === "warn").length;
              seedAssistantQuestion(
                qualityAssistantSeedQuestion({
                  pass: 0,
                  warn,
                  fail,
                  evaluated: coverage.evaluated + coverage.partial,
                  status: fail > 0 ? "FAIL" : warn > 0 ? "WARN" : "N/A",
                }),
              );
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
      <div className={main}>
        {header}
        <p className="sr-only" role="status">{t("quality.loading")}</p>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={main}>
        {header}
        <ErrorState title={t("quality.errors.issues")} message={state.message} />
      </div>
    );
  }

  const { total } = state.overview;
  if (state.overview.coverage.tables === 0) {
    return (
      <div className={main}>
        {header}
        <Card><EmptyState title={t("quality.empty.title")} description={t("quality.empty.desc")} actionLabel={t("quality.empty.action")} actionHref="/add" /></Card>
      </div>
    );
  }

  const tableCoverage = state.overview.coverage;
  const legacyTables = state.overview.legacyTables;
  const legacyRunIsOlder = Boolean(legacyRun && filteredTable && legacyRun !== filteredTable.runId);

  return (
    <div className={main}>
      {header}

      <p className="text-sm text-muted-foreground" data-testid="quality-coverage">
        {t("quality.coverage.line", {
          tables: tableCoverage.tables,
          evaluated: tableCoverage.evaluated,
          partial: tableCoverage.partial,
          notEvaluated: tableCoverage.not_evaluated,
          unreadable: tableCoverage.unreadable,
        })}{" "}
        {t("quality.coverage.issues", { count: total, tables: tables.length })}
        {issues.length < total ? ` ${t("quality.coverage.more", { shown: issues.length, total })}` : null}
        {legacyTables && legacyTables.total !== undefined && legacyTables.total > legacyTables.shown
          ? ` ${t("quality.coverage.legacyMore", { shown: legacyTables.shown, total: legacyTables.total })}`
          : null}
      </p>

      {legacyRunIsOlder && filteredTable ? (
        <p className="text-sm" role="note">
          {t("quality.legacyRun.text", { run: legacyRun })}{" "}
          <Link
            className="text-brand-text underline"
            to={`/tables/${encodeURIComponent(filteredTable.datasetId)}?${new URLSearchParams({
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
              <option key={table.datasetId} value={table.datasetId}>
                {table.title}
              </option>
            ))}
            {/* A visible table from the URL that has no issues keeps its place in the filter. */}
            {datasetFilter && !filteredTable && !invalidDataset ? <option value={datasetFilter}>{datasetFilter}</option> : null}
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

      {tableCoverage.partial > 0 ? (
        <p className="text-sm text-muted-foreground">{t("quality.coverage.partial", { count: tableCoverage.partial })}</p>
      ) : null}
      {tableCoverage.not_evaluated > 0 ? (
        <p className="text-sm text-muted-foreground">{t("quality.coverage.notEvaluated", { count: tableCoverage.not_evaluated })}</p>
      ) : null}
      {tableCoverage.unreadable > 0 ? (
        <p className="text-sm text-status-failure" role="alert">
          {t("quality.coverage.failed", { count: tableCoverage.unreadable })}
        </p>
      ) : null}
    </div>
  );
}
