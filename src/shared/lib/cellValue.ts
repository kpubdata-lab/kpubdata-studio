/**
 * One way to show a cell from KPubData Builder (#484).
 *
 * Builder 1.30.0 says per column how its values travel (`wire_encoding`, builder#735).
 * A `decimal_string` column arrives as exact decimal text — every Decimal, and any
 * integer beyond ±(2^53−1) — and must stay text: through `Number()` the integer
 * `9007199254740993` becomes `…992`. Until now precision held only because no screen
 * happened to convert; every table of Builder values now goes through here instead.
 *
 * The encoding is read from each response, not remembered per column: the Builder may
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

/**
 * What a cell is, for how it is drawn (#844). Decided from the column's `logical_type` as
 * Builder sent it — never from how a value happens to look: a text column of digits is a
 * code, and `identifier` says so outright.
 */
export type CellKind = "number" | "date" | "link" | "text" | "missing";

export interface CellDisplay {
  kind: CellKind;
  /** The text to show. A number's is the text Builder sent; a date's is rearranged. */
  text: string;
  /** For `link`: the address, which is also the text. */
  href?: string;
  /** For `number`, when it is a plain decimal: how to draw its digits in threes. */
  digits?: DigitGroups;
}

/** `int64`, `uint8`, `float64`, `decimal` — the column dtypes that hold a quantity. */
const NUMERIC_TYPE = /^(u?int\d*|float\d*|decimal)$/;
const DATE_TYPE = /^(date|datetime|time)$/;
/** A plain decimal: sign, digits, fraction. Exponents, `NaN` and `inf` are left as sent. */
const PLAIN_DECIMAL = /^([+-]?)(\d+)(\.\d+)?$/;
/** An ISO date or date-time as Builder sends one, with the parts that are kept. */
const ISO_MOMENT = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;
/** A whole value that is one web address. */
const WEB_ADDRESS = /^https?:\/\/\S+$/i;

/** A plain decimal split for drawing: the integer part in groups of three, left to right. */
export interface DigitGroups {
  sign: string;
  /** `["1", "234", "567"]` for 1234567; one group when the number is not grouped. */
  groups: string[];
  /** The fraction with its point (`.50`), or an empty string. */
  fraction: string;
}

/**
 * `text` as groups of three digits, or `null` when it is not a plain decimal. The digits
 * are cut, never parsed, so an exact decimal or an integer beyond 2^53 keeps every one
 * (#484), and joined again the parts are `text`. Four digits and fewer are one group:
 * `2024` is far more often a year than a quantity, and reads the same either way.
 */
export function digitGroups(text: string): DigitGroups | null {
  const parts = PLAIN_DECIMAL.exec(text);
  if (!parts) return null;
  const [, sign, whole, fraction = ""] = parts;
  if (whole.length <= 4) return { sign, groups: [whole], fraction };
  const head = whole.length % 3 || 3;
  const groups = [whole.slice(0, head)];
  for (let at = head; at < whole.length; at += 3) groups.push(whole.slice(at, at + 3));
  return { sign, groups, fraction };
}

/**
 * An ISO date or date-time as it reads in a table: `2026-09-08`, `2026-09-08 13:05`, with
 * seconds only when they are not zero. The text is rearranged, not parsed into a moment —
 * no time zone is applied and nothing is rounded — and anything that is not ISO, such as a
 * provider's own `24.01.25`, comes back unchanged.
 */
export function readableMoment(text: string): string {
  const parts = ISO_MOMENT.exec(text);
  if (!parts) return text;
  const [, date, minutes, seconds, fraction, zone] = parts;
  if (!minutes) return date;
  const subsecond = fraction && /[1-9]/.test(fraction) ? `.${fraction.replace(/0+$/, "")}` : "";
  const second = subsecond || (seconds && seconds !== "00") ? `:${seconds ?? "00"}${subsecond}` : "";
  const offset = zone === undefined ? "" : zone === "Z" ? " UTC" : ` ${zone}`;
  return `${date} ${minutes}${second}${offset}`;
}

/** How to draw `value` of a column whose encoding and logical type are these. */
export function cellDisplay(encoding: WireEncoding | undefined, logicalType: string | undefined, value: unknown): CellDisplay {
  const text = cellValue(encoding, value);
  if (value === null || value === undefined) return { kind: "missing", text };
  // A column this Studio cannot read, and anything nested, is shown as the text it has.
  if (encoding === UNSUPPORTED_WIRE_ENCODING || (typeof value === "object" && value !== null)) return { kind: "text", text };
  if (logicalType !== undefined && NUMERIC_TYPE.test(logicalType)) {
    const digits = digitGroups(text);
    return digits ? { kind: "number", text, digits } : { kind: "number", text };
  }
  if (logicalType !== undefined && DATE_TYPE.test(logicalType)) return { kind: "date", text: readableMoment(text) };
  // A code is text, whatever it looks like — and is not an address even when it is one.
  if (logicalType !== "identifier" && typeof value === "string" && WEB_ADDRESS.test(value)) {
    return { kind: "link", text, href: value };
  }
  return { kind: "text", text };
}
