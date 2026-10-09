/**
 * The algorithm behind a run's Gold ratio splits, next to its pipeline (#671).
 *
 * Read from the run's manifest and its BuildSpec (see `splitAlgorithm.ts` for how an
 * absent field is read). The card is left out when the run has no split; when it has
 * one but neither source can be read, it says so.
 *
 * The run is compared with the table's previous run — the next older one in Builder's
 * run history. A rebuild of the same BuildSpec and seed whose rows land in other splits
 * is explained when the two algorithms differ; nothing is said when either is unnamed.
 */
import { useTranslation } from "react-i18next";

import { getBuildManifest } from "@/features/artifacts/api";
import { listDatasetRuns } from "@/features/datasets/api";
import { RUN_HISTORY_LIMIT } from "@/features/datasets/runHistory";
import { getBuildSpecSnapshot } from "@/features/runs/api/runDetail";
import { useAsync, type AsyncState } from "@/features/runs/asyncState";
import { extractDatasetId } from "@/features/runs/buildContext";
import {
  algorithmName,
  resolveSplitAlgorithm,
  splitAlgorithmsDiffer,
  splitModeOf,
  type RunSplitAlgorithm,
  type SplitMode,
} from "@/features/runs/splitAlgorithm";
import type { BuildSpecSnapshotResponse } from "@/shared/lib/builderApi";
import { Card } from "@/shared/ui";
import { MissingStatus, NormalStatus } from "@/shared/ui/StatusState";

interface PreviousRunSplit {
  runId: string;
  split: RunSplitAlgorithm;
}

/** The previous run of the same table and its split, or null when there is none to compare. */
async function previousRunSplit(datasetId: string, runId: string, signal: AbortSignal): Promise<PreviousRunSplit | null> {
  const { runs } = await listDatasetRuns(datasetId, RUN_HISTORY_LIMIT, signal);
  const index = runs.findIndex((run) => run.run_id === runId);
  const previous = index >= 0 ? runs[index + 1] : undefined;
  if (!previous) return null;
  const [algorithm, mode] = await Promise.all([
    getBuildManifest(previous.run_id, signal).then(
      (manifest) => manifest.split_algorithm,
      () => null,
    ),
    getBuildSpecSnapshot(previous.run_id, signal).then(
      (snapshot): SplitMode => splitModeOf(snapshot.spec),
      (): SplitMode => "unknown",
    ),
  ]);
  return { runId: previous.run_id, split: resolveSplitAlgorithm(algorithm, mode) };
}

export function SplitAlgorithmCard({
  runId,
  specState,
  goldHasSplits,
}: {
  runId: string;
  specState: AsyncState<BuildSpecSnapshotResponse>;
  /** A Gold stage detail of this run reports split row counts. */
  goldHasSplits: boolean;
}) {
  const { t } = useTranslation();
  // The manifest is written when the run ends. While the page holds back the run's spec
  // because the run is still on its way (`idle`, #842), the manifest is not there either.
  const runHasEnded = specState.status !== "idle";
  const manifest = useAsync((signal) => getBuildManifest(runId, signal), [runId, runHasEnded], "", runHasEnded);

  const specSettled = specState.status === "loaded" || specState.status === "error";
  const manifestSettled = manifest.status === "loaded" || manifest.status === "error";
  const mode: SplitMode = specState.status === "loaded" ? splitModeOf(specState.data.spec) : "unknown";
  const split =
    specSettled && manifestSettled
      ? resolveSplitAlgorithm(manifest.status === "loaded" ? manifest.data.split_algorithm : null, mode)
      : null;
  const named = split ? algorithmName(split) : null;
  const datasetId = specState.status === "loaded" ? extractDatasetId(specState.data.spec) : null;

  const previous = useAsync(
    (signal) => (named && datasetId ? previousRunSplit(datasetId, runId, signal) : Promise.resolve(null)),
    [runId, datasetId, named],
    "",
  );

  // Shown when the run has a split, or may have one that cannot be read.
  if (!split || split.kind === "none") return null;
  if (split.kind === "unknown" && mode !== "ratio" && !goldHasSplits) return null;

  const differs = previous.status === "loaded" && previous.data !== null && splitAlgorithmsDiffer(split, previous.data.split);

  return (
    <Card>
      <h3 className="text-sm font-semibold">{t("runs.split.title")}</h3>
      <div className="mt-2 flex flex-col gap-1 text-sm">
        {split.kind === "recorded" ? (
          <>
            <NormalStatus className="font-mono">{split.algorithm}</NormalStatus>
            {!split.known ? <p className="text-xs text-muted-foreground">{t("runs.split.unfamiliar")}</p> : null}
          </>
        ) : split.kind === "legacy" ? (
          <>
            <NormalStatus className="font-mono">{split.algorithm}</NormalStatus>
            <p className="text-xs text-muted-foreground">{t("runs.split.legacy")}</p>
          </>
        ) : split.kind === "key" ? (
          <NormalStatus>{t("runs.split.key")}</NormalStatus>
        ) : (
          <p className="flex items-center gap-2">
            <MissingStatus label={t("runs.split.cannotTell")} />
            <span className="text-xs text-muted-foreground">{t("runs.split.cannotTell")}</span>
          </p>
        )}
        {differs && previous.status === "loaded" && previous.data ? (
          <p className="mt-1 text-xs text-status-warning" data-testid="split-algorithm-differs">
            {t("runs.split.differs", { run: previous.data.runId, algorithm: algorithmName(previous.data.split) })}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
