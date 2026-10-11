/**
 * A source's parameter form, generated from the dataset's query definition (#899).
 *
 * Builder sends `CatalogDataset.query_parameters` (contract 1.120.0): each parameter's
 * provider `name`, the library's `alias`, `type`, `required`, `enum`, `description` and
 * `example`. The whole field is null when the dataset has no definition — unknown, not
 * "no parameters" — and then the JSON editor is the only input, as before.
 *
 * The JSON text stays the one source of truth: a field reads its value from it and
 * writes back into it, so a saved spec loads exactly as it was saved and parameters the
 * definition does not list are kept. Builder passes `sources[].params` to kpubdata's
 * `Dataset.list(**params)`, which accepts either spelling and maps the alias onto the
 * provider's name; a field writes the alias when there is one — the name kpubdata
 * documents for callers — and reads whichever spelling a saved spec used.
 */
import { i18n } from "@/shared/i18n";
import type { CatalogQueryParameter } from "@/shared/lib/builderApi";
import type { JsonValue } from "@/shared/lib/types";

/** The key a field writes: the library's alias, else the provider's name. */
export function queryParamKey(param: CatalogQueryParameter): string {
  return param.alias ?? param.name;
}

/** The JSON text as an object, or null when it is not a JSON object (the form cannot edit it). */
export function paramsObject(text: string): Record<string, JsonValue> | null {
  try {
    const parsed: unknown = JSON.parse(text.trim() || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, JsonValue>;
  } catch {
    return null;
  }
}

function spellings(param: CatalogQueryParameter): string[] {
  return param.alias && param.alias !== param.name ? [param.alias, param.name] : [param.name];
}

/** The parameter's value in `params` under either spelling, as text ("" when absent). */
export function readQueryParam(params: Record<string, JsonValue>, param: CatalogQueryParameter): string {
  for (const key of spellings(param)) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return "";
}

/**
 * `text` with the parameter set to `value` under its key, the other spelling removed, and
 * the parameter left out when `value` is empty. Other keys keep their values and order.
 * Returns `text` unchanged when it is not a JSON object.
 */
export function writeQueryParam(text: string, param: CatalogQueryParameter, value: string): string {
  const params = paramsObject(text);
  if (!params) return text;
  const key = queryParamKey(param);
  const next: Record<string, JsonValue> = {};
  let placed = false;
  for (const [existing, existingValue] of Object.entries(params)) {
    if (!spellings(param).includes(existing)) {
      next[existing] = existingValue;
    } else if (!placed && value !== "") {
      next[key] = value;
      placed = true;
    }
  }
  if (!placed && value !== "") next[key] = value;
  return JSON.stringify(next, null, 2);
}

const FORMATS: Partial<Record<NonNullable<CatalogQueryParameter["type"]>, { pattern: RegExp; message: string }>> = {
  integer: { pattern: /^-?\d+$/, message: "buildSpec.params.badInteger" },
  number: { pattern: /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/, message: "buildSpec.params.badNumber" },
  date_yyyymmdd: { pattern: /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/, message: "buildSpec.params.badDate" },
  date_yyyymm: { pattern: /^\d{4}(0[1-9]|1[0-2])$/, message: "buildSpec.params.badMonth" },
};

/**
 * Why `value` does not fit the parameter, or undefined. An empty value is judged only by
 * `required`; a parameter whose `type` is null is not checked for a format.
 */
export function queryParamError(param: CatalogQueryParameter, value: string): string | undefined {
  const label = queryParamKey(param);
  const trimmed = value.trim();
  if (trimmed === "") return param.required ? i18n.t("buildSpec.params.missing", { name: label }) : undefined;
  if (param.enum && !param.enum.includes(trimmed)) {
    return i18n.t("buildSpec.params.notInEnum", { name: label, values: param.enum.join(", ") });
  }
  const format = param.type ? FORMATS[param.type] : undefined;
  if (format && !format.pattern.test(trimmed)) return i18n.t(format.message, { name: label });
  return undefined;
}

/**
 * Every parameter of the definition checked against the JSON text, as one message, or
 * undefined when they all fit. A text that is not a JSON object is left to the JSON
 * check, which owns that message.
 */
export function checkQueryParams(
  text: string,
  parameters: readonly CatalogQueryParameter[] | null | undefined,
): string | undefined {
  if (!parameters || parameters.length === 0) return undefined;
  const params = paramsObject(text);
  if (!params) return undefined;
  const errors = parameters
    .map((param) => queryParamError(param, readQueryParam(params, param)))
    .filter((error): error is string => Boolean(error));
  return errors.length > 0 ? errors.join(" ") : undefined;
}
