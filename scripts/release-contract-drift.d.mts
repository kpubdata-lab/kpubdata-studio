/** Types for `release-contract-drift.mjs`, so its tests can import it (#980). */
export interface PairedContractResult {
  ok: boolean;
  message: string;
  version?: string;
}

export const ROOT: string;
export const DRIFT_TESTS: string[];
export function readMinimum(root?: string): string;
export function checkPairedContract(input: {
  contractText: string | null;
  tag: string;
  expectVersion?: string;
  minimum: string;
}): PairedContractResult;
