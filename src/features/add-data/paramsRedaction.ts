/**
 * Public API source sourceParams display/storage secret redaction (#283 follow-up §1).
 *
 * publicApi.sourceParams is JSON text and may contain credentials like public data portal serviceKey —
 * features/assistant/scrub.ts itself is built on this assumption. Apply the same principle that
 * urlRedaction.ts applies to URL endpoint query parameters to sourceParams object/JSON text.
 * Do not create new secret detection logic; reuse existing detectors from features/assistant/scrub.ts
 * (isSecretKey/looksLikeSecret) and judge only at key/value granularity.
 *
 * This module is for display/localStorage storage only. Never touch actual Builder submission values
 * (BuildSpec.sources[0].params) — callers (ReviewBuildStep/model.ts redactBuildSpecForDisplay/draftStorage)
 * create only redacted copies, keeping in-memory draft/spec unchanged.
 */
import { hasSecretPlaceholder, isSecretKey, looksLikeSecret, REDACTED_SECRET_MARKER } from "@/features/assistant/scrub";
import { REDACTED_PLACEHOLDER } from "@/features/add-data/urlRedaction";
import type { JsonValue } from "@/shared/lib/types";

// Same reason as URL endpoint's REDACTED_PLACEHOLDER (urlRedaction.ts): use project-scoped namespace —
// bare REDACTED could conflict with legitimate API values like {"status":"REDACTED"} (#283 follow-up §3, same principle).
export const PARAMS_REDACTED_SENTINEL = "__KPD_PARAMS_SECRET_REDACTED__";

export interface RedactedParams {
  params: Record<string, JsonValue>;
  hadSecret: boolean;
}

/**
 * In source.params object (canonical BuildSpec's sources[0].params), replace only values identified
 * as secrets with sentinel. Keep non-sensitive key/values unchanged.
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
 * Display/storage redaction for draft.publicApi.sourceParams (Configure step JSON textarea source).
 * If valid JSON, delegate to redactSourceParamsObject to hide only secret-identified values.
 *
 * If unparseable as JSON (incomplete input strings, etc.), cannot reliably distinguish key/value boundaries,
 * so fail-closed: treat entire content as sentinel — same principle as malformed URL storage fail-closed
 * (sanitizeUrlEndpointForStorage). Empty strings have no secrets, so keep as-is.
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
 * When restoring a saved draft, check if sourceParams contains redaction markers (= actual secret original is lost).
 * Used to fail-closed buildSpecFromDraft/toBuildSpec — avoid submitting marker as if it were a real parameter value.
 *
 * Recognize all markers used at persistence boundaries in one place (S07 review §1):
 * redactSourceParamsText's __KPD_PARAMS_SECRET_REDACTED__, URL query's __KPD_URL_SECRET_REDACTED__,
 * redactSecrets()'s terminal [REDACTED], scrub internals __SCRUBBED_*.
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
