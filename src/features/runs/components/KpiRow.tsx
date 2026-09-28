/**
 * Builds top KPI tile (#379 split from BuildsPage).
 *
 * KPI calculated only within list returned by `/builds` — do not fabricate figures beyond
 * this scope since Builder has no total count.
 */
import { useTranslation } from "react-i18next";

import { computeBuildKpi } from "@/features/runs/model";
import { Card } from "@/shared/ui";


function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

/**
 * Running KPI maintains running+queued(+cancelling) sum as value (existing policy), but hint shows
 * only status breakdown counted within actual query scope — never guess figures (#286 follow-up §3).
 */
function runningBreakdownHint(
  kpi: ReturnType<typeof computeBuildKpi>,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (kpi.running === 0) return t("builds.kpi.scope");
  const parts: string[] = [];
  if (kpi.runningOnly > 0) parts.push(t("builds.kpi.running", { count: kpi.runningOnly }));
  if (kpi.cancellingOnly > 0) parts.push(t("builds.kpi.cancelling", { count: kpi.cancellingOnly }));
  if (kpi.queuedOnly > 0) parts.push(t("builds.kpi.queued", { count: kpi.queuedOnly }));
  return parts.join(" · ");
}

export function KpiRow({ kpi }: { kpi: ReturnType<typeof computeBuildKpi> }) {
  const { t } = useTranslation();
  const scopeHint = t("builds.kpi.scopeHint", {
    count: kpi.scopeCount,
    limit: kpi.scopeLimit,
    more: kpi.scopeCount >= kpi.scopeLimit ? t("builds.kpi.maybeMore") : "",
  });
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <KpiTile label={t("builds.kpi.buildsScope")} value={String(kpi.scopeCount)} hint={scopeHint} />
      <KpiTile label="Success" value={String(kpi.succeeded)} hint={t("builds.kpi.scope")} />
      <KpiTile label="Failed" value={String(kpi.failed)} hint={t("builds.kpi.scope")} />
      <KpiTile
        label="Running"
        value={kpi.runningAvailable ? String(kpi.running) : "N/A"}
        hint={
          kpi.runningAvailable
            ? runningBreakdownHint(kpi, t)
            : t("builds.kpi.completedOnlyHint")
        }
      />
    </div>
  );
}
