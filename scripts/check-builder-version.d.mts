/** Types for `check-builder-version.mjs`, so the gate's tests can import it (kpubdata#895). */
export interface Result {
  ok: boolean;
  message: string;
  warning?: boolean;
}

export interface Lookup {
  latestTag(): string;
  hasTag(tag: string): boolean;
}

export const ROOT: string;
export const BUILDER_REPO: string;
export const github: Lookup;
export function parseVersion(text: string | null | undefined): [number, number, number] | null;
export function isReleaseBranch(headRef: string | null | undefined): boolean;
export function compareWithBuilder(input: { studioVersion: string; builderTag: string | null; headRef?: string }): Result;
export function requireBuilderTag(input: { studioVersion: string; tagExists: boolean }): Result;
export function readStudioVersion(root?: string): string;
export function main(argv: string[], options?: { lookup?: Lookup; studioVersion?: string }): number;
