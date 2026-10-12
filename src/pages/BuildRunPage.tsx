/**
 * Build execution trace page (/builds/:buildId/run) — legacy deep-link compatibility.
 *
 * Previously, this was a static placeholder always showing "waiting (queued)" and stepper step 0,
 * regardless of buildId (UI audit #3). Now it displays the same canonical state as Builds list/detail
 * (BuildsPage): historical summary + live job polling.
 *
 * Step-by-step progress (Bronze/Silver/Gold), execution event timeline, and cooperative execution
 * cancellation are already provided by canonical Build detail (`/builds?run=...`) — this legacy screen
 * doesn't create a second state machine; it guides users to canonical detail instead. Facts and their
 * wording are kept consistent ("API unsupported" is the same across both).
 */
import { useParams } from "react-router-dom";
import { useSelectedRunPolling } from "@/features/runs/useSelectedRunPolling";
import { useBuild } from "@/features/runs/useBuild";
import type { BuildRunStatus } from "@/shared/lib/types";
import { Card, EmptyState, LinkButton, PageHeader, Skeleton, StatusBadge } from "@/shared/ui";
import { useTranslation } from "react-i18next";

/**
 * Page tracking canonical state of build execution.
 *
 * @returns Execution state screen.
 */
export function BuildRunPage() {
  const { t } = useTranslation();
  const { buildId = "" } = useParams();

   // historical: same getBuild() query as Builds list/edit (mock mode uses deterministic mock,
   // real mode uses Builder history + Studio-stored spec).
  const { build, isLoading: historicalLoading, error: historicalError } = useBuild(buildId);

   // live: if an active job exists in the registry (#245/#255), its state is most recent — reuse
   // the same hook as Builds detail (BuildsPage) to ensure both screens use the same canonical run state.
   // The demo is asked the same way (#902): its history runs are not in its job registry, so they
   // answer 404 and the historical state above is trusted as-is.
  const live = useSelectedRunPolling(buildId || null);

  const runStatus: BuildRunStatus | undefined =
    live.kind === "job" ? live.job.status : build?.status;

  return (
    <div className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        title={t("buildRun.title", { id: buildId || t("buildRun.fallbackId") })}
        description={t("buildRun.desc")}
        actions={
          <LinkButton variant="secondary" to={`/refresh-jobs?run=${encodeURIComponent(buildId)}`}>
            {t("buildRun.manageInDetail")}
          </LinkButton>
        }
      />

      <Card className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{t("buildRun.status")}</span>
        {historicalLoading && live.kind !== "job" ? (
          <Skeleton className="h-6 w-20" />
        ) : runStatus ? (
          <StatusBadge status={runStatus} />
        ) : (
          <span className="text-xs text-muted-foreground">
            {historicalError ?? t("buildRun.unknownStatus")}
          </span>
        )}
        {live.kind === "job" && (live.job.status === "queued" || live.job.status === "running" || live.job.status === "cancelling") ? (
          <span className="text-xs text-muted-foreground">{t("buildRun.liveUpdating")}</span>
        ) : null}
        {live.kind === "error" ? (
          <span className="text-xs text-status-warning">
            {t("buildRun.liveFailed")}
          </span>
        ) : null}
        {live.kind === "permission_denied" ? (
          <span className="text-xs text-status-failure">
            {t("buildRun.liveForbidden")}
          </span>
        ) : null}
      </Card>

      <Card variant="dashed" className="p-0">
        <EmptyState
          title={t("buildRun.detailHint.title")}
          description={t("buildRun.detailHint.desc")}
        />
      </Card>

      <div className="flex flex-wrap gap-3">
        <LinkButton variant="secondary" to={`/refresh-jobs?run=${encodeURIComponent(buildId)}`}>
          {t("buildRun.openDetail")}
        </LinkButton>
        <LinkButton variant="secondary" to={`/refresh-jobs/${buildId}/artifacts`}>
          {t("buildRun.openArtifacts")}
        </LinkButton>
        <LinkButton variant="ghost" to={`/refresh-jobs/${buildId}/edit`}>
          {t("buildRun.editSpec")}
        </LinkButton>
      </div>
    </div>
  );
}
