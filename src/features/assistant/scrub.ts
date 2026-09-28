/**
/**
 * Secret scrubbing — mask before LLM transmission (#206, ST-A3, #226).
 *
 * sourceParams contains public data portal service key (can be any name). LLM sees BuildSpec with values masked;
 * if LLM echoes it back, we detect + redact in regenerated spec.
 */

const SECRET_KEY_PATTERNS = [
  /^servicekey$/i,
  /^api[_-]?key$/i,
  /^.*[_-]?key$/i,
  /^.*[_-]?token$/i,
  /^.*[_-]?secret$/i,
];

// Shannon entropy threshold (bits/char). Catches base64(≈6.0)/hex(=4.0) keys;
// misses plain text. Previous (unique/length)*100 heuristic: longer unique-char
// ratio drops; 200-char base64 key computed as 32%, missed (#226 defect d).
const SHANNON_ENTROPY_THRESHOLD = 4.0;
const MIN_LENGTH_FOR_ENTROPY = 24;

/**
 * Default set of "provenance-verified exact values" exempt from generic entropy false-positives (empty set).
 *
 * Callers not passing this arg skip exact-value exemption (backward compat).
 *
 * Existing consumers (paramsRedaction/urlRedaction/savedSpecs/general assistant) not passing this arg
 * maintain identical scrub behavior to main. Only Assistant path passes actual Builder/evidence-generated run id set,
 * preventing canonical run id from marked [REDACTED].
 *
 * Important: exemption applies only to "exact strings confirmed as actual resource identity this execution",
 * not "looks like run id shape". secret-named field masking (isSecretKey) and explicit credential assignment
 * scrubbing always applied before this exemption.
 */
const NO_SAFE_VALUES: ReadonlySet<string> = new Set();

/**
 * Escape metacharacters safely for regex literal injection.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import { i18n } from "@/shared/i18n";

export function isSecretKey(keyName: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(keyName));
}

/**
 * Shannon entropy (bits per character). Reflects character frequency distribution;
 * accurately catches long high-entropy strings (base64/hex keys).
 */
function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const ch of value) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let h = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Whether value looks like high-entropy secret (API key/token). Use Shannon entropy.
 *
 * @param value - String to check.
 * @param safeValues - Exact value set confirmed as actual resource identity this execution. Only values
 *   matching exactly (case/full string) exempt from entropy heuristic. No partial/shape matching
 *   — crafted `<words>-<timestamp>` secret not exact-match, falls through to entropy check below.
 */
export function looksLikeSecret(
  value: string,
  safeValues: ReadonlySet<string> = NO_SAFE_VALUES,
): boolean {
  if (value.length < MIN_LENGTH_FOR_ENTROPY) return false;
  if (safeValues.has(value)) return false;
  return shannonEntropy(value) >= SHANNON_ENTROPY_THRESHOLD;
}

const SCRUBBED_PREFIX = "__SCRUBBED_";
const SCRUBBED_PATTERN = /__SCRUBBED_[A-Za-z0-9-]+_\d+__/g;
const SCRUBBED_TEST_PATTERN = /__SCRUBBED_[A-Za-z0-9-]+_\d+__/;

/**
 * `redactSecrets()` terminator marker where secret values finally substitute.
 * Round-trip restore impossible (placeholder→original irreversible) — placeholder persists in output.
 * If this string appears in restored spec/draft, treat as "secret already removed → re-enter needed" (#206, S07 review §1).
 */
export const REDACTED_SECRET_MARKER = "[REDACTED]";

export interface ScrubResult {
  scrubbed: unknown;
  placeholders: Map<string, string>;
}

export interface SecretScrubber {
  scrub(data: unknown): unknown;
  scrubText(text: string): string;
  restore(data: unknown): unknown;
  restoreText(text: string): string;
  readonly placeholders: ReadonlyMap<string, string>;
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export interface SecretScrubberOptions {
  /**
   * Exact value set this scrubber exempts from generic entropy check.
   * secret-named field / explicitly trusted marker / Assistant-verified run id.
   * Does not affect secret-named field / explicit credential assignment scrubbing.
   * If not passed, empty set — same behavior as main.
   */
  safeRunIds?: ReadonlySet<string>;
}

export function createSecretScrubber(
  id = requestId(),
  options: SecretScrubberOptions = {},
): SecretScrubber {
  const placeholders = new Map<string, string>();
  const safeRunIds = options.safeRunIds ?? NO_SAFE_VALUES;
  let counter = 0;

  function replace(value: string): string {
    const placeholder = `${SCRUBBED_PREFIX}${id}_${counter++}__`;
    placeholders.set(placeholder, value);
    return placeholder;
  }

  function scrubValue(key: string, value: unknown): unknown {
     // (1) Secret-named fields always scrubbed regardless of entropy.
     // (2) Others exempt from entropy false-positive only on safeRunIds exact match.
    if (typeof value === "string" && (isSecretKey(key) || looksLikeSecret(value, safeRunIds))) {
      return replace(value);
    }
    // Traverse arrays too (#226 defect a). BuildSpec.sources is array;
    // !Array.isArray(value) branch cut recursion; sources[].params.serviceKey
    // unreached.
    if (Array.isArray(value)) {
      return value.map((v, i) => scrubValue(`${key}[${i}]`, v));
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = scrubValue(k, v);
      }
      return result;
    }
    return value;
  }

  /**
   * Decide whether to mask fragments adjacent to safe id. Safe id itself never reaches here —
   * `nonSafeLooksSecret` checks "remaining after removing all safe ids from this token" looks like secret,
   * prevents short-chopped fragments from bypassing entropy check (`<secret>/<safeId>` case).
   */
  function maskAdjacentFragment(fragment: string, nonSafeLooksSecret: boolean): string {
    if (!fragment || fragment.startsWith(SCRUBBED_PREFIX)) return fragment;
    if (nonSafeLooksSecret || looksLikeSecret(fragment, safeRunIds)) return replace(fragment);
    return fragment;
  }

  function scrubText(text: string): string {
    const assignmentPattern = /\b([\w-]*(?:servicekey|api[_-]?key|token|secret))([ \t]*[:=][ \t]*)([^\s,}\]]+)/gi;
    const assigned = text.replace(assignmentPattern, (_match, key: string, separator: string, value: string) => {
      const quote = value.startsWith("\"") || value.startsWith("'") ? value[0] : "";
      const raw = quote ? value.slice(1, value.endsWith(quote) ? -1 : undefined) : value;
      return `${key}${separator}${quote}${replace(raw)}${quote}`;
    });

    const scanForSecrets = (segment: string): string =>
      segment.replace(/\S{24,}/g, (token) => {
        if (token.startsWith(SCRUBBED_PREFIX) || !looksLikeSecret(token, safeRunIds)) return token;
        return replace(token);
      });

    const alternation = [...safeRunIds]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp);
    if (alternation.length === 0) return scanForSecrets(assigned);

    // Build regex boundary: safe id not directly preceded/followed by alphanumeric.
    // (`runId=<id>`, `/builds/<id>`, word boundary OK). Direct alphanumeric attachment fails boundary check; entire token scrubbed.
    const boundary = `(?<![A-Za-z0-9])(?:${alternation.join("|")})(?![A-Za-z0-9])`;
    const safeIdTest = new RegExp(boundary);
    const safeIdSplit = new RegExp(boundary, "g");

    // Process by whitespace-delimited tokens. Token without safe id gets existing entropy
    // check as-is; token with safe id preserves safe id part, checks before/after (and
    // between) non-safe fragments. Don't simply exempt fragments; instead, "remove safe id,
    // check remainder whole" — if looks like secret, mask all non-safe fragments — like `<secret>/<safeId>`
    // prevents short-chopped secret fragments from bypassing entropy check.
    return assigned.replace(/\S+/g, (token) => {
      if (token.startsWith(SCRUBBED_PREFIX)) return token;
      if (!safeIdTest.test(token)) {
        return looksLikeSecret(token, safeRunIds) ? replace(token) : token;
      }
      safeIdSplit.lastIndex = 0;
      const nonSafeLooksSecret = looksLikeSecret(token.replace(safeIdSplit, ""), safeRunIds);
      safeIdSplit.lastIndex = 0;
      let out = "";
      let cursor = 0;
      for (const match of token.matchAll(safeIdSplit)) {
        const index = match.index ?? 0;
        out += maskAdjacentFragment(token.slice(cursor, index), nonSafeLooksSecret) + match[0];
        cursor = index + match[0].length;
      }
      return out + maskAdjacentFragment(token.slice(cursor), nonSafeLooksSecret);
    });
  }

  function restore(data: unknown): unknown {
    if (typeof data === "string" && data.startsWith(SCRUBBED_PREFIX)) {
      const value = placeholders.get(data);
      if (value === undefined) throw new Error(i18n.t("assistant.scrub.unknownPlaceholder"));
      return value;
    }
    if (Array.isArray(data)) return data.map(restore);
    if (data && typeof data === "object") {
      return Object.fromEntries(
        Object.entries(data as Record<string, unknown>).map(([key, value]) => [key, restore(value)]),
      );
    }
    return data;
  }

  function restoreText(text: string): string {
    return text.replace(SCRUBBED_PATTERN, (placeholder) => {
      const value = placeholders.get(placeholder);
      if (value === undefined) throw new Error(i18n.t("assistant.scrub.unknownPlaceholder"));
      return value;
    });
  }

  return { scrub: (data) => scrubValue("root", data), scrubText, restore, restoreText, placeholders };
}

export function scrubSecrets(data: unknown): ScrubResult {
  const scrubber = createSecretScrubber();
  return { scrubbed: scrubber.scrub(data), placeholders: new Map(scrubber.placeholders) };
}

export function restoreSecrets(data: unknown, placeholders: Map<string, string>): unknown {
  if (typeof data === "string" && data.startsWith(SCRUBBED_PREFIX)) {
    const value = placeholders.get(data);
    if (value === undefined) throw new Error(i18n.t("assistant.scrub.unknownPlaceholder"));
    return value;
  }
  // Array round-trip restore (#226 defect c). scrub traverses arrays; restore does too.
  if (Array.isArray(data)) {
    return data.map((v) => restoreSecrets(v, placeholders));
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = restoreSecrets(v, placeholders);
    }
    return result;
  }
  return data;
}

export function hasSecretPlaceholder(data: unknown): boolean {
  if (typeof data === "string") {
    return SCRUBBED_TEST_PATTERN.test(data) || data.includes(REDACTED_SECRET_MARKER);
  }
  if (Array.isArray(data)) return data.some(hasSecretPlaceholder);
  if (data && typeof data === "object") {
    return Object.values(data as Record<string, unknown>).some(hasSecretPlaceholder);
  }
  return false;
}

export function redactSecrets(
  data: unknown,
  safeRunIds: ReadonlySet<string> = NO_SAFE_VALUES,
): unknown {
  const scrubber = createSecretScrubber(undefined, { safeRunIds });
  const scrubbed = scrubber.scrub(data);

  function redact(value: unknown): unknown {
    if (typeof value === "string" && hasSecretPlaceholder(value)) return REDACTED_SECRET_MARKER;
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redact(item)]),
      );
    }
    return value;
  }

  return redact(scrubbed);
}
