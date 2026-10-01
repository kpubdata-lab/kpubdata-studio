/**
 * Shared by `__tests__/publishIssueCodes.test.ts` and the contract drift check
 * (`src/shared/lib/contractDrift.test.ts`, the file CI's `Builder contract drift` job
 * runs against Builder's main): which `PublishIssue.code` values the contract lists, and
 * which of them lack a localized message or next step (#644).
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type IssueLocale = {
  publish?: { issues?: Record<string, { message?: unknown; action?: unknown } | undefined> };
};

/** The keys of `PublishIssue.code`'s `x-codes` in a parsed contract. */
export function contractIssueCodesOf(contract: unknown): string[] {
  const xCodes = (contract as {
    components?: { schemas?: { PublishIssue?: { properties?: { code?: { "x-codes"?: Record<string, unknown> } } } } };
  }).components?.schemas?.PublishIssue?.properties?.code?.["x-codes"];
  return Object.keys(xCodes ?? {});
}

/** The keys of `PublishIssue.code`'s `x-codes` in the contract file at `path`. */
export function contractIssueCodes(path: string): string[] {
  return contractIssueCodesOf(parse(readFileSync(path, "utf-8")));
}

/** `lang:code.field` for every code whose message or next step is missing or empty. */
export function missingIssueEntries(codes: readonly string[], locales: Record<string, IssueLocale>): string[] {
  const missing: string[] = [];
  for (const [lang, locale] of Object.entries(locales)) {
    for (const code of codes) {
      const entry = locale.publish?.issues?.[code];
      for (const field of ["message", "action"] as const) {
        const value = entry?.[field];
        if (typeof value !== "string" || value.trim() === "") missing.push(`${lang}:${code}.${field}`);
      }
    }
  }
  return missing;
}

/** Codes on one side only, as `+code` (contract only) and `-code` (Studio only). */
export function issueCodeDrift(studio: readonly string[], contract: readonly string[]): string[] {
  const studioSet = new Set(studio);
  const contractSet = new Set(contract);
  return [
    ...contract.filter((code) => !studioSet.has(code)).map((code) => `+${code}`),
    ...studio.filter((code) => !contractSet.has(code)).map((code) => `-${code}`),
  ].sort();
}
