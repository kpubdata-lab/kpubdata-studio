/**
 * Usability preflight before Preview — only works when Dataset metadata
 * (`request_parameters`) makes required request parameters known.
 *
 * - JSON syntax errors not generated here (that's `buildSpecFromDraft`'s job) —
 *   only missing required key reported as user-facing message.
 * - Empty string or whitespace-only values count as missing (many public data
 *   APIs treat empty as "not transmitted"; real E2E also `{}` → NO_MANDATORY_REQUEST_PARAMETERS).
 * - Does not replace Builder/Core validation — just pre-guidance.
 */
import { i18n } from "@/shared/i18n";
import type { CatalogRequestParameter } from "@/shared/lib/builderApi";

export interface RequiredParamsCheck {
  /** Error shown to user (empty if validation passes). */
  error?: string;
}

export function requiredParamNames(
  requestParameters: readonly CatalogRequestParameter[] | undefined,
): string[] {
  return (requestParameters ?? []).filter((p) => p.required).map((p) => p.name);
}

export function checkRequiredParams(
  sourceParamsText: string,
  requestParameters: readonly CatalogRequestParameter[] | undefined,
): RequiredParamsCheck {
  const required = requiredParamNames(requestParameters);
  if (required.length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceParamsText.trim() || "{}");
  } catch {
    // JSON errors guided separately.
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;

  const missing = required.filter((name) => {
    const value = obj[name];
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  });
  if (missing.length === 0) return {};
  return { error: i18n.t("addData.requiredParams", { params: missing.join(", ") }) };
}

/**
 * Example JSON text for request parameter input help/placeholder.
 * With metadata, show concrete example; without, show neutral example.
 */
export function exampleParamsText(
  requestParameters: readonly CatalogRequestParameter[] | undefined,
): string {
  const params = requestParameters ?? [];
  if (params.length === 0) return '{"region": "seoul"}';
  // Example shows "required minimum" — if no required params exist, show all.
  const shown = params.some((p) => p.required) ? params.filter((p) => p.required) : params;
  const entries = shown.map((p) => [p.name, p.example ?? ""] as const);
  return JSON.stringify(Object.fromEntries(entries));
}

/** Check if there's a target for "apply example" button — must have at least one parameter with example. */
export function hasExampleParams(
  requestParameters: readonly CatalogRequestParameter[] | undefined,
): boolean {
  return (requestParameters ?? []).some((p) => p.example);
}

/**
 * "Apply example" button behavior — fill request parameter JSON with example values
 * from metadata.
 *
 * - Secret parameters never in Builder `/catalog` request_parameters (excluded from
 *   allowlist like serviceKey), so no values generated here.
 * - Do not invent values for parameters without example — only fill where example
 *   exists.
 * - Do not overwrite user-entered values (safe merge: skip already-filled keys) —
 *   clicking button does not lose existing input.
 * - If existing text not valid JSON object (including empty), create fresh from
 *   examples alone.
 */
export function mergeExampleParams(
  currentText: string,
  requestParameters: readonly CatalogRequestParameter[] | undefined,
): string {
  const withExample = (requestParameters ?? []).filter(
    (p): p is CatalogRequestParameter & { example: string } => Boolean(p.example),
  );
  if (withExample.length === 0) return currentText;

  let base: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(currentText.trim() || "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      base = { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // If existing text not JSON, create fresh from examples alone.
  }

  for (const p of withExample) {
    const existing = base[p.name];
    const isEmpty = existing === undefined || existing === null || (typeof existing === "string" && existing.trim() === "");
    if (isEmpty) base[p.name] = p.example;
  }

  return JSON.stringify(base, null, 2);
}
