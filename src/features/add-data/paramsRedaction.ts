/**
 * Public API source sourceParams display/storage secret redaction (#283 follow-up
 * review §1).
 *
 * publicApi.sourceParams is JSON text that may mix in credentials like public data
 * portal serviceKey — `features/assistant/scrub.ts` itself was designed with this
 * premise. Apply same principle as `urlRedaction.ts` applies to URL endpoint query
 * parameters, now to sourceParams object/JSON text. No new secret detection logic —
 * reuse existing detector (`isSecretKey`/`looksLikeSecret`) from
 * `features/assistant/scrub.ts` directly, judging only at key/value level.
 *
 * This module is display/localStorage-save only. Never touches actual Builder
 * submission value (`BuildSpec.sources[0].params`) — caller
 * (`ReviewBuildStep`/`model.ts`'s `redactBuildSpecForDisplay`/`draftStorage`)
 * creates only redacted copy, keeping in-memory draft/spec with original values.
 */
import { hasSecretPlaceholder, isSecretKey, looksLikeSecret, REDACTED_SECRET_MARKER } from "@/features/assistant/scrub";
import { REDACTED_PLACEHOLDER } from "@/features/add-data/urlRedaction";
import type { JsonValue } from "@/shared/lib/types";

// Like URL endpoint `REDACTED_PLACEHOLDER` (urlRedaction.ts), use project
// namespace — bare `REDACTED` could collide with normal API value like
// {"status":"REDACTED"} (#283 follow-up review §3, same principle).
export const PARAMS_REDACTED_SENTINEL = "__KPD_PARAMS_SECRET_REDACTED__";

export interface RedactedParams {
  params: Record<string, JsonValue>;
  hadSecret: boolean;
}

/**
 * From source.params object (canonical BuildSpec's `sources[0].params`), replace
 * only values judged as secret with sentinel. Keep non-sensitive key/value unchanged.
 */
export function redactSourceParamsObject(params: Record<string, JsonValue>): RedactedParams {
  let hadSecret = false;
  const visit = (value: JsonValue, key?: string): JsonValue => {
    if (key && isSecretKey(key)) {
      hadSecret = true;
      return PARAMS_REDACTED_SENTINEL;
    }
    if (typeof value === "string") {
      if (looksLikeSecret(value)) {
        hadSecret = true;
        return PARAMS_REDACTED_SENTINEL;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, visit(childValue, childKey)]));
    }
    return value;
  };
  const redacted = visit(params) as Record<string, JsonValue>;
  return { params: redacted, hadSecret };
}

export interface RedactedParamsText {
  text: string;
  hadSecret: boolean;
}

/**
 * Display/storage redaction for `draft.publicApi.sourceParams` (Configure step JSON
 * textarea source). If valid JSON, delegate to `redactSourceParamsObject` to hide
 * values judged as secret.
 *
 * For values that fail JSON parse (mid-edit temp strings etc.), cannot reliably
 * distinguish key/value boundaries, so fail-closed whole to sentinel — same
 * principle as malformed endpoint storage fail-closed (`sanitizeUrlEndpointForStorage`).
 * Empty string has no secret, so leave as-is.
 */
export function redactSourceParamsText(sourceParams: string): RedactedParamsText {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceParams);
  } catch {
    return sourceParams.trim().length > 0
      ? { text: PARAMS_REDACTED_SENTINEL, hadSecret: true }
      : { text: sourceParams, hadSecret: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return sourceParams.trim().length > 0
      ? { text: PARAMS_REDACTED_SENTINEL, hadSecret: true }
      : { text: sourceParams, hadSecret: false };
  }

  const { params: redacted, hadSecret } = redactSourceParamsObject(parsed as Record<string, JsonValue>);
  if (!hadSecret) return { text: sourceParams, hadSecret: false };
  return { text: JSON.stringify(redacted, null, 2), hadSecret: true };
}

/**
 * On restored draft, check if sourceParams has redaction marker remaining (= real
 * secret original lost). Triggers fail-closed in `buildSpecFromDraft`/`toBuildSpec`
 * — prevent marker from being submitted to Builder as real parameter value.
 *
 * All markers at persistence boundary recognized in one place (S07 review §1):
 * `redactSourceParamsText`'s `__KPD_PARAMS_SECRET_REDACTED__`, URL query's
 * `__KPD_URL_SECRET_REDACTED__`, `redactSecrets()`'s terminal `[REDACTED]`, scrub
 * internals `__SCRUBBED_*`.
 */
export function sourceParamsHasRedactedSecret(sourceParams: string): boolean {
  return (
    sourceParams.includes(PARAMS_REDACTED_SENTINEL) ||
    sourceParams.includes(REDACTED_PLACEHOLDER) ||
    hasSecretPlaceholder(sourceParams)
  );
}

export function jsonValueHasRedactedSecret(value: unknown): boolean {
  const serialized = JSON.stringify(value) ?? "";
  return (
    serialized.includes(PARAMS_REDACTED_SENTINEL) ||
    serialized.includes(REDACTED_PLACEHOLDER) ||
    serialized.includes(REDACTED_SECRET_MARKER) ||
    hasSecretPlaceholder(value)
  );
}
