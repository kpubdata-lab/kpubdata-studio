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
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { safe: true, resolvedUrl: DEFAULT_LLM_BASE_URL, isDefault: true };
  }

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
  return {
    safe: true,
    resolvedUrl: normalized,
    isDefault: normalized === DEFAULT_LLM_BASE_URL.replace(/\/+$/, ""),
  };
}

/** Substitute known key values in error messages/logs so API key does not leak. */
export function redactApiKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("[REDACTED]");
}
