/**
 * What to do about a run that ended because its provider keys were gone (#787, #846).
 *
 * Whether the run can be retried from the edit page depends on whether its spec can be
 * read anywhere:
 *
 * - this browser kept it — it is saved when a job is submitted;
 * - or Builder has a snapshot of it — a run that was interrupted after it started does,
 *   and a run that never started (its keys were gone while it waited) does not.
 *
 * With either, the edit page loads and running the spec again submits a new run that
 * names this one as what it retries. With neither — another browser submitted a run
 * that never started — there is no spec to edit anywhere, and the link goes to Add Data.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { hasBuildSpec } from "@/features/build-spec/specStore";
import { getBuildSpecSnapshot } from "@/features/runs/api/runDetail";
import { Card } from "@/shared/ui";

type SpecAvailability = "here" | "checking" | "on-builder" | "nowhere";

function useSpecAvailability(runId: string): SpecAvailability {
  // Read once per run: the store is not asked again on every render.
  const keptHere = useMemo(() => hasBuildSpec(runId), [runId]);
  const [onBuilder, setOnBuilder] = useState<boolean | null>(null);

  useEffect(() => {
    if (keptHere) return;
    const controller = new AbortController();
    setOnBuilder(null);
    getBuildSpecSnapshot(runId, controller.signal).then(
      () => {
        if (!controller.signal.aborted) setOnBuilder(true);
      },
      () => {
        // Not there, or it could not be asked: either way there is no spec to promise.
        if (!controller.signal.aborted) setOnBuilder(false);
      },
    );
    return () => controller.abort();
  }, [keptHere, runId]);

  if (keptHere) return "here";
  if (onBuilder === null) return "checking";
  return onBuilder ? "on-builder" : "nowhere";
}

export function KeysLostCard({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const spec = useSpecAvailability(runId);

  return (
    <Card data-keys-lost={runId} variant="error">
      <h3 className="text-sm font-semibold">{t("provider.missingKey.title")}</h3>
      <p className="mt-2 text-sm">{t("provider.missingKey.lost")}</p>
      {spec === "checking" ? null : spec === "nowhere" ? (
        <>
          <p className="mt-1 text-sm">{t("provider.missingKey.lostNoSpec")}</p>
          <Link className="mt-3 inline-block text-sm font-medium underline" data-keys-lost-next="add" to="/add">
            {t("provider.missingKey.addAgain")}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm">{t("provider.missingKey.lostNext")}</p>
          <Link
            className="mt-3 inline-block text-sm font-medium underline"
            data-keys-lost-next="edit"
            to={`/refresh-jobs/${encodeURIComponent(runId)}/edit`}
          >
            {t("provider.missingKey.retry")}
          </Link>
        </>
      )}
    </Card>
  );
}
