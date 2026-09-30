/**
 * A run's quality results and a dataset's runs, shared by Table Detail's run view and its
 * snapshot view (#526). In the snapshot view the run is provenance: the run that
 * produced the snapshot on screen.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { formatDateTime, type DatasetStage } from "@/features/datasets/model";
import { QualityBadge } from "@/features/quality/QualityBadge";
import type { qualityResultsForSource, summarizeQuality } from "@/features/quality/model";
import type { BuildQualityResponse, DatasetRunSummary } from "@/shared/lib/builderApi";
import { Card, EmptyState, Skeleton } from "@/shared/ui";

export interface AsyncState<T> {
  status: "idle" | "loading" | "loaded" | "error";
  data?: T;
  error?: string;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function QualityTab({ state, status, results, drift, datasetId, runId, source, stage }: { state: AsyncState<BuildQualityResponse>; status: ReturnType<typeof summarizeQuality>; results: ReturnType<typeof qualityResultsForSource>; drift: BuildQualityResponse["schema_drift"][string]; datasetId: string; runId: string; source: string; stage?: DatasetStage }) {
  const { t } = useTranslation();
  if (state.status === "loading" || state.status === "idle") return <Card><Skeleton className="h-40 w-full" /></Card>;
  if (state.status === "error") return <Card variant="error"><QualityBadge status="N/A" /><p className="mt-3 text-sm">{state.error}</p></Card>;
  const counts = results.reduce((current, result) => ({ ...current, [result.status]: current[result.status] + 1 }), { pass: 0, warn: 0, fail: 0 });
  const qualityCenterHref = `/quality?${new URLSearchParams({ dataset: datasetId, ...(runId ? { run: runId } : {}), ...(source ? { source } : {}), ...(stage ? { stage } : {}) }).toString()}`;
  return <div className="space-y-4"><div className="flex justify-end"><Link className="text-xs font-medium text-accent-subtle-foreground underline" to={qualityCenterHref}>{t("datasetDetail.viewInQualityCenter")}</Link></div><div className="grid gap-4 lg:grid-cols-2"><Card><h3 className="text-sm font-semibold">{t("tableDetail.run.validationSummary")}</h3><div className="mt-4 flex items-end gap-3"><span className="text-3xl font-bold">{results.length}</span><span className="pb-1 text-sm text-muted-foreground">{t("tableDetail.run.evaluatedChecks")}</span></div><div className="mt-4 flex flex-wrap gap-2"><QualityBadge status={status} /><span className="text-xs text-muted-foreground">PASS {counts.pass} · WARN {counts.warn} · FAIL {counts.fail}</span></div><p className="mt-3 text-xs text-muted-foreground">{t("datasetDetail.qualityNote")}</p></Card><Card><h3 className="text-sm font-semibold">{t("labels.schemaDrift")}</h3>{drift.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t("datasetDetail.noDrift")}</p> : <div className="mt-4 space-y-3">{drift.map((finding, index) => <div key={`${finding.kind}-${index}`} className="flex items-start justify-between gap-3 border-b border-border pb-3 text-sm last:border-0"><div><strong>{finding.kind}</strong><p className="mt-1 text-xs text-muted-foreground">{finding.detail}</p></div><span className="font-mono text-xs">{finding.column ?? "—"}</span></div>)}</div>}</Card></div>{results.length === 0 ? <Card><EmptyState title={t("datasetDetail.noQualityTitle")} description={t("datasetDetail.noQualityDesc")} /></Card> : <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><h3 className="text-sm font-semibold">{t("tableDetail.run.recentIssues")}</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">{t("labels.rule")}</th><th className="px-4 py-3">{t("labels.result")}</th><th className="px-4 py-3">{t("labels.column")}</th><th className="px-4 py-3">{t("labels.actual")}</th><th className="px-4 py-3">{t("labels.threshold")}</th></tr></thead><tbody>{results.map((result, index) => <tr key={`${result.rule}-${result.column}-${index}`} className="border-b border-border last:border-0"><td className="px-4 py-3 font-medium">{result.category} · {result.rule}</td><td className="px-4 py-3"><QualityBadge status={result.status.toUpperCase() as "PASS" | "WARN" | "FAIL"} /></td><td className="px-4 py-3">{result.column ?? "—"}</td><td className="px-4 py-3 font-mono text-xs">{formatJson(result.actual)}</td><td className="px-4 py-3 font-mono text-xs">{formatJson(result.threshold)}</td></tr>)}</tbody></table></div></Card>}</div>;
}

export function BuildsTab({ runs, selectedRunId }: { runs: DatasetRunSummary[]; selectedRunId: string }) {
  const { t } = useTranslation();
  return <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><h3 className="text-sm font-semibold">{t("tableDetail.run.recentRuns")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("datasetDetail.runsNote")}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="px-5 py-3">{t("labels.run")}</th><th className="px-5 py-3">{t("labels.status")}</th><th className="px-5 py-3">{t("labels.updated")}</th><th className="px-5 py-3"></th></tr></thead><tbody>{runs.map((run) => <tr key={run.run_id} className={`border-b border-border last:border-0 ${run.run_id === selectedRunId ? "bg-accent-subtle" : ""}`}><td className="px-5 py-3 font-mono text-xs">{run.run_id}{run.run_id === selectedRunId ? ` · ${t("tableDetail.run.selected")}` : ""}</td><td className="px-5 py-3">{run.status}</td><td className="px-5 py-3">{formatDateTime(run.finished_at ?? run.started_at)}</td><td className="px-5 py-3 text-right"><Link className="font-medium text-accent-subtle-foreground underline" to={`/refresh-jobs/${encodeURIComponent(run.run_id)}`}>{t("datasetDetail.view")}</Link></td></tr>)}</tbody></table></div></Card>;
}
