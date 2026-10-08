/**
 * What to do about a run that ended because its provider keys were gone (#787, #846).
 *
 * Such a run never started: Builder failed it before `build()`, so it has no run
 * directory, no spec snapshot and no manifest. The only copy of what it was asked to
 * build is the one this browser kept when it submitted the run. So the way on depends
 * on whether that copy is here:
 *
 * - it is: the edit page can load the spec, and running it again submits a new run that
 *   names this one as what it retries;
 * - it is not (another browser submitted it, or the copy was cleared): there is no spec
 *   to edit anywhere, and the link goes to Add Data to make the build again.
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { loadBuildSpec } from "@/features/build-spec/specStore";
import { Card } from "@/shared/ui";

export function KeysLostCard({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const hasSpec = loadBuildSpec(runId) !== null;

  return (
    <Card data-keys-lost={runId} variant="error">
      <h3 className="text-sm font-semibold">{t("provider.missingKey.title")}</h3>
      <p className="mt-2 text-sm">{t("provider.missingKey.lost")}</p>
      {hasSpec ? (
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
      ) : (
        <>
          <p className="mt-1 text-sm">{t("provider.missingKey.lostNoSpec")}</p>
          <Link className="mt-3 inline-block text-sm font-medium underline" data-keys-lost-next="add" to="/add">
            {t("provider.missingKey.addAgain")}
          </Link>
        </>
      )}
    </Card>
  );
}
