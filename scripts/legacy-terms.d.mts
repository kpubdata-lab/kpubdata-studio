/** Types for `legacy-terms.mjs`, so its tests can import it (#423). */
export interface LegacyTerm {
  term: string;
  pattern: RegExp;
  keys?: RegExp;
  now: string;
}
export interface AllowedLegacyTerm {
  lang: string;
  key: string;
  term: string;
  reason: string;
}
export const SCREEN_NAME_KEYS: RegExp;
export const LEGACY_TERMS: LegacyTerm[];
export const ALLOWED: AllowedLegacyTerm[];
export function legacyTerms(
  locales: Record<string, object>,
  allowed?: AllowedLegacyTerm[],
): {
  found: Array<{ lang: string; key: string; term: string; text: string; now: string }>;
  unused: AllowedLegacyTerm[];
};
