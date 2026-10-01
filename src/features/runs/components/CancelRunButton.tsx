/**
 * Cancel a run from its detail page (#655).
 *
 * Builder cancels cooperatively (`POST /builds/{run_id}/cancel`, builder#481, ADR 0008): a
 * `queued` job ends `cancelled` at once, a `running` one is `cancelling` until the next
 * safe stage boundary. The button only asks. What the run is now comes from the live
 * job polling the detail already does — no status is made up here (#255 §1) — so after
 * a request is accepted the button waits for Builder rather than claiming the run stopped.
 *
 * Cancelling is destructive: it asks for confirmation first, sends one request, and never
 * retries on its own. A refusal is said as Builder gave it (403 not the caller's run, 404
 * unknown to the job registry, 409 already finished).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, builderApi, type BuildJob } from "@/shared/lib/builderApi";
import { Button } from "@/shared/ui";

type CancelRequest =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "accepted" }
  | { status: "refused"; reason: "forbidden" | "notFound" | "finished" | "failed"; message?: string };

/** Live job states a cancel button is shown for; only the first two can still be cancelled. */
const CANCELLABLE: ReadonlySet<BuildJob["status"]> = new Set(["queued", "running"]);
const CANCEL_UNDER_WAY: ReadonlySet<BuildJob["status"]> = new Set(["cancelling", "cancelled"]);

function refusalOf(cause: unknown): Extract<CancelRequest, { status: "refused" }> {
  const message = cause instanceof Error ? cause.message : undefined;
  if (cause instanceof ApiError) {
    if (cause.status === 403) return { status: "refused", reason: "forbidden", message };
    if (cause.status === 404) return { status: "refused", reason: "notFound", message };
    if (cause.status === 409) return { status: "refused", reason: "finished", message };
  }
  return { status: "refused", reason: "failed", message };
}

export function CancelRunButton({ runId, job }: { runId: string; job: BuildJob }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<CancelRequest>({ status: "idle" });

  useEffect(() => setRequest({ status: "idle" }), [runId]);

  if (!CANCELLABLE.has(job.status) && !CANCEL_UNDER_WAY.has(job.status)) return null;

  const underWay = CANCEL_UNDER_WAY.has(job.status);
  // An accepted request disables the button until polling reports the new status.
  const disabled = underWay || request.status === "sending" || request.status === "accepted";

  function cancel() {
    if (!window.confirm(t("runs.cancel.confirm", { id: runId }))) return;
    setRequest({ status: "sending" });
    builderApi
      .cancelBuildJob(runId)
      .then(() => setRequest({ status: "accepted" }))
      .catch((cause: unknown) => setRequest(refusalOf(cause)));
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button disabled={disabled} loading={request.status === "sending"} size="sm" variant="danger" onClick={cancel}>
        {job.status === "cancelled" ? t("runs.cancel.done") : job.status === "cancelling" ? t("runs.cancel.underWay") : t("runs.cancel.action")}
      </Button>
      {job.status === "cancelling" ? (
        <p className="text-xs text-muted-foreground">{t("runs.cancel.cancellingHint")}</p>
      ) : request.status === "accepted" && !underWay ? (
        <p className="text-xs text-muted-foreground" role="status">{t("runs.cancel.accepted")}</p>
      ) : null}
      {request.status === "refused" ? (
        <p className="text-xs text-status-failure" role="alert">
          {t(`runs.cancel.refused.${request.reason}`)}
          {request.message ? ` (${request.message})` : null}
        </p>
      ) : null}
    </div>
  );
}
