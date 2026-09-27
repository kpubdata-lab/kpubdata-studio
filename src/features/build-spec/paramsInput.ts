/**
 * Common JSON textarea parsing logic for source parameters (#250).
 *
 * Moved as-is from `NewBuildPage`'s original local `parseSourceParams` — Add Data Workbench's
 * Public API Configure step also needs the same "JSON object" validation with Korean error
 * messages, so extracted to shared module instead of duplicating (behavior and messages unchanged —
 * existing New Build Wizard tests must pass as-is).
 */

/** Parse result: `data` on success, Korean error message on failure. */
import { i18n } from "@/shared/i18n";
import { jsonRecordSchema } from "@/shared/lib/schemas";
import type { JsonValue } from "@/shared/lib/types";

export interface ParsedSourceParams {
  data?: Record<string, JsonValue>;
  error?: string;
}

/**
 * Normalize textarea JSON parameter string to `Record<string, JsonValue>`.
 *
 * @param sourceParams - User-entered JSON string.
 * @returns Parsed object or Korean error message.
 */
export function parseSourceParams(sourceParams: string): ParsedSourceParams {
  try {
    const parsed = JSON.parse(sourceParams) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: i18n.t("buildSpec.params.mustBeObject") };
    }
    const result = jsonRecordSchema.safeParse(parsed);
    if (!result.success) return { error: i18n.t("buildSpec.params.finiteOnly") };
    return { data: result.data as Record<string, JsonValue> };
  } catch {
    return { error: i18n.t("buildSpec.params.invalidJson") };
  }
}
