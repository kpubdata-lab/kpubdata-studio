/**
 * What the preview shows when a stage detail has no sample rows (#642).
 *
 * Two different facts reach Studio as an empty `sample`: the table really has no rows to
 * show, or Builder withheld them on purpose and said why in `sample_withheld` (builder#688
 * redistribution terms, builder#900 an unreadable PII declaration). The first is an empty
 * state; the second is a policy notice. Showing both as "no preview" tells the user the
 * data is missing when it is only held back.
 *
 * The notice is a known value that needs no action of the user here, so it reads as plain
 * text (`NormalStatus`, #524), not as a failure: nothing went wrong. No row value is shown.
 *
 * An empty state is two facts as well (#844): the stage keeps no sample to show — Bronze
 * and Gold do not — or it does and the result has no rows. "No preview / not supported"
 * said neither. The caller says which, and each has its own words.
 */
import { useTranslation } from "react-i18next";

import type { SampleWithheldReason } from "@/shared/lib/builderApi.schema";
import { Card, EmptyState } from "@/shared/ui";
import { NormalStatus } from "@/shared/ui/StatusState";

/**
 * Empty-sample panel for the dataset preview tab.
 *
 * @param props.stage - The stage whose detail had no sample rows.
 * @param props.withheld - `sample_withheld` from the Silver stage detail, when present.
 * @param props.empty - Why there is nothing to show when nothing was withheld: the stage
 *   keeps no sample (`unsupported`), or it has no rows (`zero_rows`).
 * @returns A policy notice when the sample was withheld, otherwise the empty state.
 */
export function StageSampleEmpty({
  stage,
  withheld,
  empty,
}: {
  stage: string;
  withheld?: SampleWithheldReason;
  empty: "unsupported" | "zero_rows";
}) {
  const { t } = useTranslation();
  if (!withheld) {
    return (
      <Card data-sample-empty={empty}>
        {empty === "zero_rows" ? (
          <EmptyState title={t("datasetDetail.previewZeroRows")} description={t("datasetDetail.previewZeroRowsDesc", { stage })} />
        ) : (
          <EmptyState title={t("datasetDetail.previewUnsupported")} description={t("datasetDetail.previewNoneDesc", { stage })} />
        )}
      </Card>
    );
  }
  const text =
    withheld === "redistribution_forbidden"
      ? { reason: t("datasetDetail.sampleWithheld.redistributionReason"), next: t("datasetDetail.sampleWithheld.redistributionNext") }
      : { reason: t("datasetDetail.sampleWithheld.piiReason"), next: t("datasetDetail.sampleWithheld.piiNext") };
  return (
    <Card data-sample-withheld={withheld} role="status">
      <h3 className="text-sm font-semibold">{t("datasetDetail.sampleWithheld.title")}</h3>
      <p className="mt-2 text-sm">
        <NormalStatus>{text.reason}</NormalStatus>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{text.next}</p>
    </Card>
  );
}
