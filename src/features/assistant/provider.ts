/**
 * BuildSpec assistant — LLM call abstraction (#205, ST-A2).
 *
 * Studio is stateless; provider owns LLM session state, handles streaming, retry, error recovery.
 */
import { i18n } from "@/shared/i18n";
import { createSecretScrubber, type SecretScrubber } from "./scrub";

import { checkLlmBaseUrl, redactApiKey, DEFAULT_LLM_BASE_URL } from "./baseUrl";

export interface AssistExchangeOptions {
  /**
   * Exact value set exempt from generic entropy false-positives only (currently Kubi-verified run ids from evidence).
   * Passed through to LLM egress scrubber (prepareMessages → scrubText/scrub) so canonical run id
   * not marked as [REDACTED]. If not passed, same behavior as before.
   */
  safeRunIds?: ReadonlySet<string>;
}

export interface AssistMessage {
  role: "system" | "user" | "assistant";
  content: string;
  structuredContent?: unknown;
}

export interface AssistExchange {
  readonly output: AsyncIterable<string>;
  readonly displayOutput: AsyncIterable<string>;
  readonly hadSecrets: boolean;
  restoreText(text: string): string;
}

const SAFE_PROVIDER: unique symbol = Symbol("safe-assist-provider");

export interface AssistProvider {
  readonly [SAFE_PROVIDER]: true;
  exchange(messages: AssistMessage[], signal?: AbortSignal, options?: AssistExchangeOptions): AssistExchange;
  stream(messages: AssistMessage[], signal?: AbortSignal, options?: AssistExchangeOptions): AsyncIterable<string>;
  readonly isConfigured: boolean;
}

export interface AssistConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = DEFAULT_LLM_BASE_URL;

/**
 * Convert HTTP error from LLM server to safe fixed message (#256 review §2).
 *
 * raw response body never read into Error message/log (#256 review §2) — use fixed message based on status only.
 */
export function describeLlmHttpError(status: number): string {
  if (status === 401 || status === 403) {
    return i18n.t("assistant.provider.auth");
  }
  if (status === 429) {
    return i18n.t("assistant.provider.rateLimit");
  }
  if (status >= 500) {
    return i18n.t("assistant.provider.serverError");
  }
  return i18n.t("assistant.provider.callFailedStatus", { status });
}

interface AssistTransport {
  stream(messages: AssistMessage[], signal?: AbortSignal): AsyncIterable<string>;
  readonly isConfigured: boolean;
}

class ByokTransport implements AssistTransport {
  constructor(private config: AssistConfig) {}

  get isConfigured(): boolean {
    return this.config.apiKey.length > 0;
  }

  async *stream(messages: AssistMessage[], signal?: AbortSignal): AsyncIterable<string> {
    /**
     * key exfiltration minimal defense (#256 review §2): even when this provider actually calls,
     * re-validate base URL — unsafe value can bypass config screen, but blocked here.
     */
    const check = checkLlmBaseUrl(this.config.baseUrl);
    if (!check.safe) {
      throw new Error(i18n.t("assistant.provider.unsafeBaseUrl", { reason: check.reason }));
    }

    let response: Response;
    try {
      response = await fetch(`${check.resolvedUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: true,
        }),
        signal,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      throw new Error(
        redactApiKey(cause instanceof Error ? cause.message : i18n.t("assistant.provider.callFailed"), this.config.apiKey),
        { cause },
      );
    }

    if (!response.ok) {
      // raw response body never read into Error message/log (#256 review §2) — fixed message by status only.
      throw new Error(describeLlmHttpError(response.status));
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch {
          // Ignore SSE parsing errors — some chunks may be incomplete
        }
      }
    }
  }
}

function prepareMessages(messages: AssistMessage[], scrubber: SecretScrubber): AssistMessage[] {
  return messages.map(({ role, content, structuredContent }) => {
    const safeText = scrubber.scrubText(content);
    if (structuredContent === undefined) return { role, content: safeText };
    const safeStructured = scrubber.scrub(structuredContent);
    return { role, content: `${safeText}\n${JSON.stringify(safeStructured, null, 2)}` };
  });
}

const PLACEHOLDER_PREFIX = "__SCRUBBED_";
const COMPLETE_PLACEHOLDER = /^__SCRUBBED_[A-Za-z0-9-]+_\d+__/;

async function* redactDisplayOutput(output: AsyncIterable<string>): AsyncIterable<string> {
  let pending = "";
  for await (const chunk of output) {
    pending += chunk;
    while (pending) {
      const marker = pending.indexOf(PLACEHOLDER_PREFIX);
      if (marker < 0) {
        const safeLength = Math.max(0, pending.length - (PLACEHOLDER_PREFIX.length - 1));
        if (safeLength > 0) {
          yield pending.slice(0, safeLength);
          pending = pending.slice(safeLength);
        }
        break;
      }
      if (marker > 0) {
        yield pending.slice(0, marker);
        pending = pending.slice(marker);
      }
      const placeholder = pending.match(COMPLETE_PLACEHOLDER)?.[0];
      if (!placeholder) break;
      yield "[REDACTED]";
      pending = pending.slice(placeholder.length);
    }
  }

  if (pending.startsWith(PLACEHOLDER_PREFIX)) {
    yield pending.replace(/^__SCRUBBED_\S*/, "[REDACTED]");
  } else if (pending) {
    yield pending;
  }
}

class SafeAssistProvider implements AssistProvider {
  readonly [SAFE_PROVIDER] = true;

  constructor(private transport: AssistTransport) {}

  get isConfigured(): boolean {
    return this.transport.isConfigured;
  }

  exchange(messages: AssistMessage[], signal?: AbortSignal, options?: AssistExchangeOptions): AssistExchange {
    const scrubber = createSecretScrubber(undefined, { safeRunIds: options?.safeRunIds });
    const safeMessages = prepareMessages(messages, scrubber);
    const output = this.transport.stream(safeMessages, signal);
    return {
      output,
      displayOutput: redactDisplayOutput(output),
      hadSecrets: scrubber.placeholders.size > 0,
      restoreText: (text) => scrubber.restoreText(text),
    };
  }

  async *stream(messages: AssistMessage[], signal?: AbortSignal, options?: AssistExchangeOptions): AsyncIterable<string> {
    yield* this.exchange(messages, signal, options).displayOutput;
  }
}

export function createProvider(config: AssistConfig): AssistProvider {
  return new SafeAssistProvider(
    new ByokTransport({
      ...config,
      model: config.model || DEFAULT_MODEL,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
    }),
  );
}
