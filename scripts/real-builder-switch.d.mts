/** Types for `real-builder-switch.mjs`, so its tests can import it (#902). */
export const SELECTORS: Record<string, string>;
export const BASELINE: Record<string, number>;
export function countUses(file: string, source: string): number;
export function findings(
  counts: Record<string, number>,
  selectors?: Record<string, string>,
  baseline?: Record<string, number>,
): string[];
export function scan(repo: string): Record<string, number>;
