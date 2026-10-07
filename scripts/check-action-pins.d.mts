/** Types for `check-action-pins.mjs`, so the gate's tests can import it (#729). */
export interface Violation {
  path: string;
  line: number;
  ref: string;
  reason: string;
}

export const ROOT: string;
export const SWEPT_DIRS: string[];
export const KPUBDATA_REPO: string;
export function reason(ref: string): string | null;
export function check(paths: string[]): Violation[];
export function bumpKpubdata(paths: string[], sha: string): string[];
export function defaultPaths(root?: string): string[];
export function main(argv: string[]): number;
