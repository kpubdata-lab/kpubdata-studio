/**
 * Declared PII columns that Builder masked on this read (#641, builder#900).
 *
 * Builder names them (`masked_columns` on `/query` with `stage: silver`, on each `/preview`
 * source and on a Silver stage detail): each text value arrives as the mask token, any
 * other dtype as null, and a null stays null. Studio marks only the columns Builder names.
 * It never infers masking from a value, so a `[masked]` string in a column Builder did not
 * name is shown as the text it is.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** The token Builder writes in place of a masked text value (builder#689, #902). */
export const MASK_TOKEN = "[masked]";

/** The masked column set, empty when Builder named none. */
export function maskedSet(columns: readonly string[] | undefined): ReadonlySet<string> {
  return new Set(columns ?? []);
}

/** Header marker for a masked column: a word, with what it means on hover and for screen readers. */
export function MaskedColumnBadge() {
  const { t } = useTranslation();
  const explanation = t("dataTable.masked.explanation");
  return (
    <span
      className="mt-0.5 inline-flex items-center whitespace-nowrap rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
      data-masked-column="true"
      title={explanation}
    >
      <span>{t("dataTable.masked.badge")}</span>
      <span className="sr-only">{` — ${explanation}`}</span>
    </span>
  );
}

/**
 * One cell of a masked column. The mask token reads as "masked", not as data; a null may be
 * a masked non-text value or an original null — Builder does not say which, so neither does
 * this — and the tooltip says so. Anything else is drawn as `fallback`.
 */
export function MaskedCell({ value, fallback }: { value: unknown; fallback: ReactNode }) {
  const { t } = useTranslation();
  if (value === MASK_TOKEN) {
    return (
      <span className="italic text-muted-foreground" data-masked-cell="token" title={t("dataTable.masked.cellToken")}>
        {t("dataTable.masked.value")}
      </span>
    );
  }
  if (value === null || value === undefined) {
    return (
      <span data-masked-cell="null" title={t("dataTable.masked.cellNull")}>
        {fallback}
      </span>
    );
  }
  return <>{fallback}</>;
}
