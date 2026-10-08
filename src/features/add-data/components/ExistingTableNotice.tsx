/**
 * What the review step says about a table that is already there (#837).
 *
 * See `existingTables.ts`. A new table is what is built unless the user picks the other
 * choice here; while the answer is unknown the step holds the build and offers to ask again.
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { ExistingTableChoice, ExistingTables } from "@/features/add-data/existingTables";
import { Button, Card } from "@/shared/ui";

export interface ExistingTableNoticeProps {
  /** The dataset id the draft asks for — the id of the tables that are already there. */
  datasetId: string;
  existing: ExistingTables;
  choice: ExistingTableChoice;
  onChoose: (choice: ExistingTableChoice) => void;
  onRecheck: () => void;
}

export function ExistingTableNotice({ datasetId, existing, choice, onChoose, onRecheck }: ExistingTableNoticeProps) {
  const { t } = useTranslation();
  const group = useId();

  if (existing.status === "none") return null;

  if (existing.status === "checking") {
    return (
      <p className="text-sm text-muted-foreground" data-existing-table="checking" role="status">
        {t("addData.review.existingChecking")}
      </p>
    );
  }

  if (existing.status === "unknown") {
    return (
      <Card className="space-y-3 p-4" data-existing-table="unknown" variant="error">
        <p className="text-sm text-status-failure" role="alert">{t("addData.review.existingUnknown")}</p>
        <Button onClick={onRecheck} variant="secondary">{t("addData.review.existingRecheck")}</Button>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4" data-existing-table="found" variant="error">
      <div role="alert" className="space-y-1">
        <p className="text-sm font-semibold">{t("addData.review.existingTitle")}</p>
        <p className="text-sm">{t("addData.review.existingBody", { id: datasetId })}</p>
      </div>
      <ul className="space-y-0.5 text-sm">
        {existing.tables.map((table) => {
          const rows = table.current_snapshot?.row_count;
          return (
            <li className="break-all" key={table.logical_name}>
              <span className="font-mono">{table.logical_name}</span>
              {typeof rows === "number" ? (
                <span className="text-muted-foreground"> · {t("labels.rows", { count: rows })}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t("addData.review.existingChoiceLegend")}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            checked={choice === "new"}
            className="mt-1"
            name={group}
            onChange={() => onChoose("new")}
            type="radio"
            value="new"
          />
          <span>
            <span className="block font-medium">{t("addData.review.existingChoiceNew")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("addData.review.existingChoiceNewNote", { id: existing.freeId })}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            checked={choice === "refresh"}
            className="mt-1"
            name={group}
            onChange={() => onChoose("refresh")}
            type="radio"
            value="refresh"
          />
          <span>
            <span className="block font-medium">{t("addData.review.existingChoiceRefresh")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("addData.review.existingChoiceRefreshNote", { id: datasetId })}
            </span>
          </span>
        </label>
      </fieldset>
    </Card>
  );
}
