/**
 * Builder health as key-value panels (#539).
 *
 * Monitoring used to be a wall of cards behind tabs. An operator reads it top to bottom:
 * KPubData Builder API, Queue, Workers and the Snapshot store as one key-value list, then
 * the last 24 hours of refreshes, then the recent refreshes themselves.
 *
 * Every value comes from GET /monitoring/summary and GET /monitoring/builds (#516). A
 * measurement Builder sent as null is `—`, never 0; a healthy value is plain text and only
 * what needs a person's attention becomes a badge (#524).
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { i18n } from "@/shared/i18n";
import type {
  MonitoringAvailability,
  MonitoringBuildsResponse,
  MonitoringRecentRun,
  MonitoringSummaryResponse,
} from "@/shared/lib/builderApi.schema";
import { StatusBadge } from "@/shared/ui";
import { ActionableStatus, MissingStatus, NormalStatus } from "@/shared/ui/StatusState";
import { runDurationSeconds, runStatusValue } from "@/features/monitoring/model";

function locale(): string {
  return i18n.language?.startsWith("en") ? "en-US" : "ko-KR";
}

function Measured({ value, suffix }: { value: number | null; suffix?: string }) {
  const { t } = useTranslation();
  if (value === null) return <MissingStatus label={t("monitoring.measure.unavailable")} />;
  return (
    <span className="tabular-nums text-foreground">
      {value}
      {suffix}
    </span>
  );
}

/** Availability in the #524 meanings: available is plain text, anything else is a badge. */
function Availability({ availability, failureWhenUnavailable }: { availability: MonitoringAvailability; failureWhenUnavailable?: boolean }) {
  const { t } = useTranslation();
  if (availability === "available") return <NormalStatus>{t("monitoring.availability.available")}</NormalStatus>;
  if (availability === "partial") {
    return <ActionableStatus tone="warning">{t("monitoring.availability.partial")}</ActionableStatus>;
  }
  return (
    <ActionableStatus tone={failureWhenUnavailable ? "failure" : "warning"}>
      {t("monitoring.availability.unavailable")}
    </ActionableStatus>
  );
}

function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </span>
  );
}

function Row({ term, status, children }: { term: string; status: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border px-4 py-2.5 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm font-medium text-foreground">{term}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {status}
        {children}
      </dd>
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-foreground" id={id}>
      {children}
    </h2>
  );
}

export function BuilderHealthPanel({ summary }: { summary: MonitoringSummaryResponse }) {
  const { t } = useTranslation();
  const { api, queue, workers, artifact_store: store } = summary;
  const apiStatus =
    api.availability === "unavailable" ? (
      <ActionableStatus tone="warning">{t("monitoring.availability.unavailable")}</ActionableStatus>
    ) : summary.status === "degraded" ? (
      <ActionableStatus tone="warning">{t("monitoring.api.degraded")}</ActionableStatus>
    ) : (
      <NormalStatus>{t("monitoring.api.healthy")}</NormalStatus>
    );

  return (
    <section aria-labelledby="monitoring-health" className="flex flex-col gap-2">
      <SectionTitle id="monitoring-health">{t("monitoring.health.title")}</SectionTitle>
      <dl className="rounded-lg border border-border bg-card">
        <Row status={apiStatus} term={t("monitoring.health.api")}>
          <Pair label={t("monitoring.api.p95")}>
            <Measured suffix=" ms" value={api.p95_latency_ms} />
          </Pair>
          <Pair label={t("monitoring.api.samples")}>
            <Measured value={api.sample_count} />
          </Pair>
        </Row>
        <Row status={<Availability availability={queue.availability} />} term={t("monitoring.health.queue")}>
          <Pair label={t("monitoring.queue.waiting")}>
            <Measured value={queue.waiting} />
          </Pair>
          <Pair label={t("monitoring.queue.running")}>
            <Measured value={queue.running} />
          </Pair>
          <Pair label={t("monitoring.queue.total")}>
            <Measured value={queue.total} />
          </Pair>
        </Row>
        <Row status={<Availability availability={workers.availability} />} term={t("monitoring.health.workers")}>
          <Pair label={t("monitoring.workers.active")}>
            {workers.active === null || workers.capacity === null ? (
              <Measured value={null} />
            ) : (
              <span className="tabular-nums text-foreground">
                {workers.active} / {workers.capacity}
              </span>
            )}
          </Pair>
          <Pair label={t("monitoring.workers.utilization")}>
            <Measured suffix="%" value={workers.utilization === null ? null : Math.round(workers.utilization * 100)} />
          </Pair>
        </Row>
        <Row status={<Availability availability={store.availability} failureWhenUnavailable />} term={t("monitoring.health.store")}>
          <Pair label={t("monitoring.store.lastWrite")}>
            {store.last_write_at ? (
              <time className="text-foreground" dateTime={store.last_write_at}>
                {new Date(store.last_write_at).toLocaleString(locale())}
              </time>
            ) : (
              <span className="text-foreground">{t("monitoring.store.lastWriteNone")}</span>
            )}
          </Pair>
        </Row>
      </dl>
    </section>
  );
}

export function RefreshStatsPanel({ builds }: { builds: MonitoringBuildsResponse }) {
  const { t } = useTranslation();
  const measured = builds.availability !== "unavailable";
  const totals = builds.buckets.reduce(
    (acc, bucket) => ({
      success: acc.success + bucket.success,
      failed: acc.failed + bucket.failed,
      cancelled: acc.cancelled + bucket.cancelled,
    }),
    { success: 0, failed: 0, cancelled: 0 },
  );
  const count = (value: number) => <Measured value={measured ? value : null} />;

  return (
    <section aria-labelledby="monitoring-refreshes" className="flex flex-col gap-2">
      <SectionTitle id="monitoring-refreshes">{t("monitoring.builds.title")}</SectionTitle>
      <dl className="rounded-lg border border-border bg-card">
        <Row status={<Availability availability={builds.availability} />} term={t("monitoring.builds.aggregate")}>
          {builds.availability === "partial" ? (
            <span className="text-muted-foreground">{t("monitoring.builds.excluded", { count: builds.excluded_count })}</span>
          ) : null}
        </Row>
        <Row status={null} term={t("monitoring.builds.outcomes")}>
          <Pair label={t("monitoring.builds.success")}>{count(totals.success)}</Pair>
          <Pair label={t("monitoring.builds.failed")}>{count(totals.failed)}</Pair>
          <Pair label={t("monitoring.builds.cancelled")}>{count(totals.cancelled)}</Pair>
        </Row>
      </dl>
    </section>
  );
}

export function RecentRefreshesTable({ runs }: { runs: MonitoringRecentRun[] }) {
  const { t } = useTranslation();
  const caption = t("monitoring.recent.title");
  return (
    <section aria-labelledby="monitoring-recent" className="flex flex-col gap-2">
      <SectionTitle id="monitoring-recent">{caption}</SectionTitle>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("monitoring.recent.empty")}</p>
      ) : (
        // Wider than a phone: the table scrolls inside this region, never the page.
        <div
          aria-label={caption}
          className="relative max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="region"
          tabIndex={0}
        >
          <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
            <caption className="sr-only">{caption}</caption>
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-xs font-semibold text-muted-foreground" scope="col">{t("monitoring.recent.runId")}</th>
                <th className="px-3 py-2 text-xs font-semibold text-muted-foreground" scope="col">{t("monitoring.recent.status")}</th>
                <th className="px-3 py-2 text-xs font-semibold text-muted-foreground" scope="col">{t("monitoring.recent.started")}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground" scope="col">{t("monitoring.recent.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const duration = runDurationSeconds(run);
                return (
                  <tr className="border-b border-border last:border-b-0 hover:bg-muted/40" key={run.run_id}>
                    <td className="px-3 py-2">
                      <Link
                        className="break-all font-mono text-xs text-accent-subtle-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        to={`/refresh-jobs/${encodeURIComponent(run.run_id)}`}
                      >
                        {run.run_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={runStatusValue(run.status)} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {run.started_at ? new Date(run.started_at).toLocaleString(locale()) : <MissingStatus />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {duration !== null ? t("monitoring.recent.seconds", { seconds: duration }) : <MissingStatus />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
