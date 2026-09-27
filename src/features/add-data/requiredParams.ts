/**
 * Preview usability preflight — works only when the selected Dataset metadata (request_parameters)
 * is known for required request parameters.
 *
 * - Do not create JSON syntax errors here (buildSpecFromDraft already owns that path) — only return
 *   missing required keys in user-facing text.
 * - Treat empty strings/whitespace-only values as missing (many public data APIs treat empty as "not transmitted",
 *   and real E2E shows `{}` → NO_MANDATORY_REQUEST_PARAMETERS).
 * - Do not replace Builder/Core validation — this is only pre-flight guidance.
 */
import { i18n } from "@/shared/i18n";
import type { CatalogRequestParameter } from "@/shared/lib/builderApi";

export interface RequiredParamsCheck {
  /** Error to show user (empty if validation passes). */
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
    // JSON errors are handled on a separate path.
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
 * If metadata exists, create concrete example with those parameters; otherwise use neutral example.
 */
export function exampleParamsText(
  requestParameters: readonly CatalogRequestParameter[] | undefined,
): string {
  const params = requestParameters ?? [];
  if (params.length === 0) return '{"region": "seoul"}';
  // Example shows "minimum required" — if no required params exist, show all.
  const shown = params.some((p) => p.required) ? params.filter((p) => p.required) : params;
  const entries = shown.map((p) => [p.name, p.example ?? ""] as const);
  return JSON.stringify(Object.fromEntries(entries));
}

/** Check if there is a target for "Apply example values" button — needs at least one parameter with an example. */
export function hasExampleParams(
  requestParameters: readonly CatalogRequestParameter[] | undefined,
): boolean {
  return (requestParameters ?? []).some((p) => p.example);
}

/**
 * "Apply example values" button behavior — populate request parameter JSON with example values from metadata.
 *
 * - Secret parameters are never included in request_parameters by Builder /catalog (excluded from allowlist like serviceKey),
 *   so there is no value to generate here.
 * - Do not fabricate arbitrary values for parameters without examples — only fill those with examples.
 * - Do not overwrite user-entered values (safe merge: untouched keys are left alone) — pressing button doesn't lose existing input.
 * - If existing text is not valid JSON object (including empty), create new from examples only.
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
    // If existing text is not JSON, create new from examples only.
  }

  for (const p of withExample) {
    const existing = base[p.name];
    const isEmpty = existing === undefined || existing === null || (typeof existing === "string" && existing.trim() === "");
    if (isEmpty) base[p.name] = p.example;
  }

  return JSON.stringify(base, null, 2);
}
