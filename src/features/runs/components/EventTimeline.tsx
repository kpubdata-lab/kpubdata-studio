/**
 * Selected Run structured event timeline (#496 evidence, #255 P1) display component.
 *
 * Show only Builder's actual contract fields (timestamp/source_key/stage/event/status/message/metrics) as-is.
 * Do not create new verdicts here to replace Stage Progress (#488)/Quality (#486) — this component only
 * renders append-only event evidence chronologically ascending as received.
 */
import { useTranslation } from "react-i18next";
import { codeLabel } from "@/shared/i18n/codeLabels";
import { formatDateTime } from "@/features/datasets/model";
import { lastOkRunEvent, summarizeEventMetrics } from "@/features/runs/model";
import type { BuildEvent } from "@/shared/lib/builderApi";

const STATUS_STYLES: Record<BuildEvent["status"], string> = {
  ok: "bg-status-success-subtle text-status-success",
  warn: "bg-status-warning-subtle text-status-warning",
  fail: "bg-status-failure-subtle text-status-failure",
};

function EventStatusBadge({ status }: { status: BuildEvent["status"] }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {codeLabel(t, "eventStatus", status)}
    </span>
  );
}

/** In multi-source run, do not collapse events to first source; distinguish and show run-wide events (those without source_key). */
function EventSourceLabel({ sourceKey }: { sourceKey: string | null }) {
  const { t } = useTranslation();
  if (sourceKey === null) {
    return <span className="font-mono text-xs text-muted-foreground">{t("runs.timeline.wholeRun")}</span>;
  }
  return <span className="font-mono text-xs">{sourceKey}</span>;
}

/**
 * @param events - Event list sorted in chronological ascending order (Builder contract).
 */
export function EventTimeline({ events }: { events: BuildEvent[] }) {
  const { t } = useTranslation();
  if (events.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">{t("runs.timeline.empty")}</p>;
  }

  const lastOk = lastOkRunEvent(events);

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-3">{t("runs.timeline.time")}</th>
            <th className="py-2 pr-3">{t("labels.source")}</th>
            <th className="py-2 pr-3">{t("labels.stage")}</th>
            <th className="py-2 pr-3">{t("runs.timeline.event")}</th>
            <th className="py-2 pr-3">{t("labels.message")}</th>
            <th className="py-2">{t("labels.metrics")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const metricsSummary = summarizeEventMetrics(event.metrics);
            const isLastOk = lastOk !== null && event === lastOk;
            return (
              <tr
                key={`${event.seq}-${event.event}`}
                className={`border-b border-border last:border-0 ${
                  event.status === "fail" ? "bg-status-failure-subtle" : ""
                }`}
              >
                <td className="whitespace-nowrap py-2 pr-3 align-top text-xs text-muted-foreground">
                  {formatDateTime(event.timestamp)}
                </td>
                <td className="py-2 pr-3 align-top">
                  <EventSourceLabel sourceKey={event.source_key ?? null} />
                </td>
                <td className="py-2 pr-3 align-top text-xs text-muted-foreground">
                  {event.stage ? codeLabel(t, "eventStage", event.stage) : "—"}
                </td>
                <td className="py-2 pr-3 align-top">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs" title={event.event}>
                      {codeLabel(t, "event", event.event)}
                    </span>
                    <EventStatusBadge status={event.status} />
                    {isLastOk ? (
                      <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-[10px] font-medium text-brand-text">
                        {t("runs.timeline.lastOk")}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="max-w-xs py-2 pr-3 align-top text-xs">
                  {event.message ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="max-w-xs py-2 align-top text-xs text-muted-foreground">
                  {metricsSummary ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
