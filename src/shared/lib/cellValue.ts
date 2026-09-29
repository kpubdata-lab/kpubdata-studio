/**
 * One way to show a cell from KPubData Engine (#484).
 *
 * Builder 1.30.0 says per column how its values travel (`wire_encoding`, builder#735).
 * A `decimal_string` column arrives as exact decimal text — every Decimal, and any
 * integer beyond ±(2^53−1) — and must stay text: through `Number()` the integer
 * `9007199254740993` becomes `…992`. Until now precision held only because no screen
 * happened to convert; every table of Engine values now goes through here instead.
 *
 * The encoding is read from each response, not remembered per column: the Engine may
 * decide it per result set, so the same column can arrive differently.
 */
import type { z } from "zod";

import { i18n } from "@/shared/i18n";

import { UNSUPPORTED_WIRE_ENCODING, type wireEncodingSchema } from "./builderApi.schema";

export type WireEncoding = z.infer<typeof wireEncodingSchema>;

/** Column name → encoding, from whatever column list a response carries. */
export function encodingsOf(
  columns: ReadonlyArray<{ name: string; wire_encoding?: WireEncoding }> | null | undefined,
): ReadonlyMap<string, WireEncoding> {
  const map = new Map<string, WireEncoding>();
  for (const column of columns ?? []) if (column.wire_encoding) map.set(column.name, column.wire_encoding);
  return map;
}

/**
 * The text a cell shows. `null`/missing is "—"; exact decimal text is never parsed.
 * A column whose encoding this Studio does not know (#497) says so instead of showing a
 * value it cannot vouch for.
 */
export function cellValue(encoding: WireEncoding | undefined, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (encoding === UNSUPPORTED_WIRE_ENCODING) return i18n.t("api.unsupportedEncoding");
  if (typeof value === "string") return value;
  if (encoding === "decimal_string") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
