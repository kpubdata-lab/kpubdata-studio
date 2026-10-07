/** Types for `check-bundle-size.mjs`, so the gate's tests can import it (#665). */
export interface Chunk {
  name: string;
  raw: number;
  gzip: number;
}

export interface Budget {
  entryGzip: number;
  chunkGzip: number;
  chunkRaw: number;
  totalGzip: number;
  initialGzip: number;
}

export const BUDGET: Readonly<Budget>;
export const ENTRY_PATTERN: RegExp;
export function measure(dir: string): Chunk[];
export function kib(bytes: number): string;
export function initialChunks(dir: string, chunks: Chunk[]): string[];
export function checkBudget(chunks: Chunk[], budget?: Budget, initial?: string[] | null): string[];
