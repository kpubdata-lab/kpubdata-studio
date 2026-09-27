/**
 * URL source endpoint display/storage secret redaction (PR #283 review response,
 * Epic #246).
 *
 * URL source has no separate params field; secrets mix into endpoint string itself
 * as query parameters (`?api_key=...`, `?serviceKey=...`). Reuse key-name/entropy
 * detector (`isSecretKey`/`looksLikeSecret`) from `features/assistant/scrub.ts`
 * directly, judging only query parameter "values"; keep hostname/path/non-sensitive
 * parameters unchanged — no new secret detection logic here.
 *
 * This module is display/localStorage-save only. Never touches actual Builder
 * submission value (`BuildSpec.sources[0].endpoint`) — caller
 * (`ReviewBuildStep`/`draftStorage`) creates only redacted copy, keeping in-memory
 * draft/spec with original values.
 */
import { isSecretKey, looksLikeSecret } from "@/features/assistant/scrub";

// Use text without brackets — `URLSearchParams` percent-encodes values, so
// `[REDACTED]` displays as `%5BREDACTED%5D` (hard to read for humans, #283 review).
//
// Use sufficiently namespaced project value (#283 follow-up review §3) — old bare
// `REDACTED` collided with common normal API value like `?status=REDACTED`,
// causing false credential-loss detection.
export const REDACTED_PLACEHOLDER = "__KPD_URL_SECRET_REDACTED__";

export interface RedactedEndpoint {
  endpoint: string;
  hadSecret: boolean;
}

/**
 * Redact only values judged as secret from endpoint query parameters to placeholder,
 * and completely remove userinfo credential (`user:pass@host`).
 * Keep hostname/path/fragment/non-sensitive parameters unchanged (avoid unnecessary
 * removal).
 *
 * URL Auth is not in contract (#283 follow-up review §4) — do not just hide
 * userinfo; remove entirely instead of leaving it.
 *
 * Values `new URL()` cannot parse (mid-edit temp strings etc.) returned unchanged —
 * `buildSpecFromDraft` already enforces https:// format separately, no need to
 * block again here. (localStorage save path uses `sanitizeUrlEndpointForStorage`
 * instead.)
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
 * On restored draft, check if any endpoint query parameter already redacted (= real
 * secret original lost). Triggers fail-closed for Preview/Build — prevent redacted
 * placeholder from being submitted as real endpoint/credential.
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
 * Auth=None contract with no stated URL Auth support, so always error if present
 * (#283 follow-up review §4) — `buildSpecFromDraft` blocks submission using this.
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
 * Fail-closed sanitizer used only right before localStorage save (#283 follow-up
 * review §2).
 *
 * `redactUrlEndpoint` (display) returns malformed values (`new URL()` cannot parse)
 * unchanged — used when incomplete input still being edited. But storing malformed
 * value in localStorage (like `not-a-url?token=...` where query boundary unknown)
 * could leave secrets unredacted as plaintext. So storage path is separate function
 * that returns empty string on parse failure — naturally prompts re-entry via
 * https:// validation in `buildSpecFromDraft`.
 *
 * URLs with userinfo also return empty for same reason — silently removing
 * credential while keeping rest could mislead user that Auth was applied in saved
 * version (#283 follow-up review §4).
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
