/**
 * URL source endpoint secret redaction for display/storage (PR #283 review response, Epic #246).
 *
 * URL source has no separate params field; secrets are mixed into the endpoint string's query parameters
 * (`?api_key=...`, `?serviceKey=...`). Reuse the key-name/entropy-based detector from features/assistant/scrub.ts
 * (isSecretKey/looksLikeSecret) to judge only query parameter "values"; keep hostname/path/non-sensitive parameters unchanged —
 * do not reinvent secret detection logic here.
 *
 * This module is for display/localStorage storage only. Never touch actual Builder submission values (BuildSpec.sources[0].endpoint) —
 * callers (ReviewBuildStep/draftStorage) create only redacted copies, keeping in-memory draft/spec unchanged.
 */
import { isSecretKey, looksLikeSecret } from "@/features/assistant/scrub";

// Use text without brackets — URLSearchParams percent-encodes values, so `[REDACTED]` becomes
// `%5BREDACTED%5D` and is hard to read (#283 review response).
//
// Use namespace-qualified values for the project (#283 follow-up §3) — bare `REDACTED` before
// conflicted with common legitimate API values like `?status=REDACTED`, making credentials appear lost.
export const REDACTED_PLACEHOLDER = "__KPD_URL_SECRET_REDACTED__";

export interface RedactedEndpoint {
  endpoint: string;
  hadSecret: boolean;
}

/**
 * Redact only query parameter values identified as secrets, remove userinfo credential (`user:pass@host`).
 * Keep hostname/path/fragment/non-sensitive parameters unchanged (no unnecessary removal).
 *
 * URL Auth is not in the contract (#283 follow-up §4) — redact userinfo completely instead of
 * leaving it behind.
 *
 * Values that new URL() cannot parse (incomplete input strings, etc.) are returned as-is —
 * buildSpecFromDraft already enforces https:// format separately, so don't block here.
 * (For localStorage storage path, use sanitizeUrlEndpointForStorage instead of this function.)
 */
export function redactUrlEndpoint(endpoint: string): RedactedEndpoint {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { endpoint, hadSecret: false };
  }

  let hadSecret = false;
  if (url.username || url.password) {
    url.username = "";
    url.password = "";
    hadSecret = true;
  }
  for (const [key, value] of Array.from(url.searchParams.entries())) {
    if (isSecretKey(key) || looksLikeSecret(value)) {
      url.searchParams.set(key, REDACTED_PLACEHOLDER);
      hadSecret = true;
    }
  }

  return { endpoint: url.toString(), hadSecret };
}

/**
 * When restoring a saved draft, check if any query parameter in endpoint is already redacted
 * (= actual secret original is lost). Used to fail-closed Preview/Build — avoid submitting
 * redacted placeholder as if it were actual endpoint/credential.
 */
export function endpointHasRedactedSecret(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return Array.from(url.searchParams.values()).some((value) => value === REDACTED_PLACEHOLDER);
  } catch {
    return false;
  }
}

/**
 * Check if endpoint contains userinfo credential (`https://user:pass@host/...`).
 * Auth=None contract and no explicit URL Auth support, so always treat as error (#283 follow-up §4) —
 * buildSpecFromDraft blocks submission with this value.
 */
export function urlHasUserinfo(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.username !== "" || url.password !== "";
  } catch {
    return false;
  }
}

/**
 * Fail-closed sanitizer used only right before localStorage storage (#283 follow-up §2).
 *
 * redactUrlEndpoint (for display) returns unparseable values as-is — used during Configure
 * to show incomplete input. But storing malformed values in localStorage (e.g., `not-a-url?token=...`
 * where query param boundaries are unknown) leaves secrets unredacted in plaintext. So isolate
 * the storage path with a separate function that returns empty string on parse failure —
 * buildSpecFromDraft's https:// validation naturally requires re-entry.
 *
 * URLs with userinfo credential also return empty for the same reason — silently removing only
 * the credential while keeping the rest would mislead users into thinking Auth was applied (#283 follow-up §4).
 */
export function sanitizeUrlEndpointForStorage(endpoint: string): string {
  try {
    new URL(endpoint);
  } catch {
    return "";
  }
  if (urlHasUserinfo(endpoint)) return "";
  return redactUrlEndpoint(endpoint).endpoint;
}
