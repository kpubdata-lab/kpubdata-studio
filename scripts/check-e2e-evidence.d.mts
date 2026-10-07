/** Types for `check-e2e-evidence.mjs`, so the gate's tests can import it (#726). */
export interface Finding {
  path: string;
  kinds: string[];
}

export const PATTERNS: { name: string; regex: RegExp }[];
export function canaries(raw: string | undefined): string[];
export function scanText(text: string, secrets?: string[]): string[];
export function scan(paths: string[], secrets?: string[]): Finding[];
export function main(argv: string[], env?: Record<string, string | undefined>): number;
