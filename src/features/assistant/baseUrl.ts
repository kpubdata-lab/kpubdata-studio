/**
 * LLM base URL safety guard (#256 review §2).
 *
 * BYOK lets user change base URL directly; risk of API key sent to wrong (or malicious) server.
 * Studio doesn't redesign provider system; only adds minimal guard to prevent key exfiltration:
 * base address fixed to safe value; if user changes it, only HTTPS allowed; UI always shows which
 * address key sent to (§2 "API Key destination address must be verifiable").
 */

/** BYOK default LLM base URL. Must match `provider.ts` DEFAULT_BASE_URL exactly. */
import { i18n } from "@/shared/i18n";
import { runtimeOr } from "@/shared/config/runtime";

export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";

export interface BaseUrlCheck {
  /** Whether safe to send requests to this address */
  safe: boolean;
  /** Reason to show user when safe=false */
  reason?: string;
  /** Normalized URL for actual requests (default if empty input) */
  resolvedUrl: string;
  /** Whether using base address as-is (else UI must warn) */
  isDefault: boolean;
}

/**
 * Check if user-entered base URL is safe to use.
 *
 * @param rawUrl - base URL (empty string uses default).
 * @returns safety status, reason, normalized URL.
 */
export function checkLlmBaseUrl(rawUrl: string): BaseUrlCheck {
  const trimmed = rawUrl.trim() || DEFAULT_LLM_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      safe: false,
      reason: i18n.t("assistant.baseUrl.invalid"),
      resolvedUrl: trimmed,
      isDefault: false,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      safe: false,
      reason: i18n.t("assistant.baseUrl.httpsOnly"),
      resolvedUrl: trimmed,
      isDefault: false,
    };
  }

  const normalized = trimmed.replace(/\/+$/, "");
  const allowed = runtimeOr("assistantAllowedOrigins", undefined)?.split(/\s+/);
  return {
    safe: !allowed || allowed.includes(parsed.origin),
    reason: allowed && !allowed.includes(parsed.origin) ? i18n.t("assistant.baseUrl.notAllowed") : undefined,
    resolvedUrl: normalized,
    isDefault: normalized === DEFAULT_LLM_BASE_URL,
  };
}

/**
 * Whether this deployment lets Ask KPubData call an external AI provider at all (#798).
 *
 * The container image writes `assistantEnabled` into `config.js` and leaves it "false"
 * unless the operator sets `ASSISTANT_ENABLED=true` (with `ASSISTANT_ALLOWED_ORIGINS`),
 * so a hosted deployment starts with it off. A page with no runtime value — `npm run dev`,
 * the Pages demo — keeps it on, the user's own key and address as before.
 */
export function isAssistantEnabled(): boolean {
  return runtimeOr("assistantEnabled", undefined) !== "false";
}

/** Substitute known key values in error messages/logs so API key does not leak. */
export function redactApiKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("[REDACTED]");
}
