/**
 * A saved analysis Builder will not run again as it is (builder#875, #565).
 *
 * An analysis saved before Builder's SQL changed carries `migration_required`, and
 * `POST /analyses/{id}/run` answers 409 `analysis_migration_required`. Studio says why
 * and what to do — open it, check the SQL, save it as a new analysis — without naming
 * the engines behind the change.
 */
import { useTranslation } from "react-i18next";

/** Builder's refusal to re-run an analysis saved in an earlier SQL. */
export const MIGRATION_REQUIRED = "analysis_migration_required";

/** Why a saved analysis is not run again, and what to do instead. */
export function MigrationNotice({ where = "list" }: { where?: "list" | "workspace" }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-status-warning-border bg-status-warning-subtle p-4" data-block={MIGRATION_REQUIRED} role="status">
      <p className="text-sm font-semibold text-status-warning">{t("analyses.migrationTitle")}</p>
      <p className="mt-1 text-sm">{where === "list" ? t("analyses.migrationBody") : t("analyses.migrationWorkspace")}</p>
    </div>
  );
}
