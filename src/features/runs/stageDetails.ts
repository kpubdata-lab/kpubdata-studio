/**
 * Run stage detail query and representation helpers (#379 split from BuildsPage).
 */
import { useEffect, useState } from "react";

import { getBuildStageDetail } from "@/features/datasets/api";
import { DATASET_STAGES } from "@/features/datasets/model";
import { firstFailedStage } from "@/features/runs/model";
import type { AsyncState } from "@/features/runs/asyncState";
import type {
  RunStageEntry,
  RunStagesResponse,
  StageDetailResponse,
} from "@/shared/lib/builderApi";

/**
 * Pipeline / Stage Progress visualization (#255 follow-up §6).
 *
 * Treat only Bronze/Silver/Gold as canonical Stages — Source/Output are context/endpoint representations,
 * not Stage states themselves. Do not create new Stages like Validate or Artifact.
 */
export type StageName = (typeof DATASET_STAGES)[number];

export type StageDetailEntry =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: StageDetailResponse }
  | { status: "error" };

export function stageDetailKey(sourceKey: string, stage: StageName): string {
  return `${sourceKey}:${stage}`;
}

/** Narrow entry type to the requested stage's detail only when entry actually contains it. */
export function pickStageDetail<S extends StageName>(
  entry: StageDetailEntry | undefined,
  stage: S,
): Extract<StageDetailResponse, { stage: S }> | null {
  if (!entry || entry.status !== "loaded" || entry.data.stage !== stage) return null;
  return entry.data as Extract<StageDetailResponse, { stage: S }>;
}

/**
 * Fetch stage detail only for completed && available source×stage pairs — avoid eager-fetching
 * all source×stage and exploding request volume. Query with bounded concurrency (3); abort
 * previous requests when run changes.
 */
export function useStageDetails(runId: string, stagesState: AsyncState<RunStagesResponse>): Record<string, StageDetailEntry> {
  const [details, setDetails] = useState<Record<string, StageDetailEntry>>({});

  useEffect(() => {
    setDetails({});
    if (stagesState.status !== "loaded") return;
    const sources = stagesState.data.sources;
    const targets: { sourceKey: string; stage: StageName }[] = [];
    for (const source of sources) {
      for (const stage of DATASET_STAGES) {
        if (source[stage].status === "completed" && source[stage].available) {
          targets.push({ sourceKey: source.source_key, stage });
        }
      }
    }
    if (targets.length === 0) return;

    const controller = new AbortController();
    const concurrency = Math.min(3, targets.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < targets.length) {
        const target = targets[nextIndex++];
        const key = stageDetailKey(target.sourceKey, target.stage);
        setDetails((prev) => ({ ...prev, [key]: { status: "loading" } }));
        try {
          const detail = await getBuildStageDetail(runId, target.stage, target.sourceKey, 5, controller.signal);
          if (controller.signal.aborted) return;
          setDetails((prev) => ({ ...prev, [key]: { status: "loaded", data: detail } }));
        } catch {
          if (controller.signal.aborted) return;
          // detail is compact supplementary info only — even if fetch fails, Stage summary (status/available)
          // is already confirmed, so the badge continues displaying normally.
          setDetails((prev) => ({ ...prev, [key]: { status: "error" } }));
        }
      }
    }

    void Promise.all(Array.from({ length: concurrency }, worker));
    return () => controller.abort();
  }, [runId, stagesState]);

  return details;
}

/** Within a source, not_run stages that come after the actual failed stage ("not yet reached"). Comparison, not guessing. */
export function isUnreachedStage(source: RunStageEntry, stage: StageName): boolean {
  const failedAt = firstFailedStage(source);
  if (!failedAt || source[stage].status !== "not_run") return false;
  return DATASET_STAGES.indexOf(stage) > DATASET_STAGES.indexOf(failedAt);
}

export function formatRecordCount(
  value: number | null,
  t: (key: string) => string,
): string {
  return value === null ? "N/A" : `${value.toLocaleString("ko-KR")}${t("builds.data.rowsUnit")}`;
}
