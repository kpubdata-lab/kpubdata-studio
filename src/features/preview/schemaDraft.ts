/**
 * Schema-contract draft generation (VAL-4, #227).
 *
 * Deterministically derives a BuildSpec sources[].schema draft from the
 * /preview response's column schema. No LLM — nullable/dtype/unique_count
 * are observed facts computed over the fully fetched table.
 *
 * Caution — single-fetch limits:
 *   the required verdict is true only for the parameter range queried this
 *   time. Other dates/regions can still yield null. So the draft must not
 *   be auto-finalized — user approval is required, and the UI must surface
 *   this limit via warnings.
 */
import { i18n } from "@/shared/i18n";
import type { PreviewColumn } from "@/shared/lib/builderApi.schema";
import type { SchemaContract } from "@/shared/lib/types";

/** Schema-draft derivation result. */
export interface SchemaDraft {
  /** Contract directly serializable to BuildSpec sources[].schema. */
  contract: SchemaContract;
  /** Columns with unique_count == row_count (key candidates); user suggestions. */
  keyCandidates: string[];
  /** Warnings about the draft's limits; the UI must show them to the user. */
  warnings: string[];
}

/**
 * Derives a schema-contract draft from the /preview column schema.
 *
 * @param columns Column list of the /preview response (name/dtype/nullable/unique_count).
 * @param rowCount Total fetched row count (independent of preview_limit).
 */
export function draftSchemaContract(
  columns: PreviewColumn[],
  rowCount: number,
): SchemaDraft {
  const required = columns.filter((c) => !c.nullable).map((c) => c.name);
  const dtypes: Record<string, string> = {};
  for (const c of columns) {
    dtypes[c.name] = c.dtype;
  }
  const keyCandidates = columns
    .filter((c) => rowCount > 0 && c.unique_count === rowCount)
    .map((c) => c.name);
  const warnings: string[] =
    rowCount === 0
      ? [i18n.t("preview.schemaDraft.zeroRows")]
      : [i18n.t("preview.schemaDraft.scopeNote")];
  return {
    contract: { required, dtypes, casts: {} },
    keyCandidates,
    warnings,
  };
}
