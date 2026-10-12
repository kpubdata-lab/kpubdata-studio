/**
 * Build execution info query API (#120, F02).
 *
 * The run is read by the runs client in force (#902): from a Builder, its spec snapshot,
 * history, manifest and job decide; in the demo, its history. `runRecord.ts` says how.
 */
import { i18n } from "@/shared/i18n";
import type { BuildRun } from "@/shared/lib/types";
import { runsClient } from "./client";

/**
 * Query build execution info by buildId.
 *
 * @param buildId - Build ID to query (run_id).
 * @param signal - Aborts the requests, for a screen that no longer wants the answer.
 * @returns Build execution info.
 * @throws Error if spec or status cannot be determined authoritatively.
 */
export async function getBuild(buildId: string, signal?: AbortSignal): Promise<BuildRun> {
  if (!buildId) {
    throw new Error(i18n.t("runs.errors.missingId"));
  }
  return runsClient().getRun(buildId, signal);
}
