/**
 * Assistant evidence grounding (#256).
 *
 * For the current `AssistantContext`, construct a safe evidence bundle using only Builder's actual APIs
 * (`/catalog`, `/datasets/*`, `/builds/*`). As a last-line defense against raw credentials/service
 * keys appearing in evidence, pass through `redactSecrets` (#206, reusing the existing assistant module).
 *
 * Even if some evidence queries fail, do not fail the entire process — use `partial`/`unavailable`
 * to clearly show what sections could not be verified, so Assistant doesn't answer as if "everything was confirmed."
 */
import {
  getBuildQuality,
  getBuildStageDetail,
  getDataset,
  listBuildStages,
  listDatasetRuns,
} from "@/features/datasets/api";
import { loadBuildSpec } from "@/features/build-spec/specStore";
import { getBuildSpecSnapshot } from "@/features/runs/api/runDetail";
import { redactSecrets } from "@/features/assistant/scrub";
import { builderApi } from "@/shared/lib/builderApi";
import { parse as parseYaml } from "yaml";
import type { AssistantContext, AssistantEvidence, AssistantEvidenceSource, AssistantKnownRefs } from "./types";
import { datasetRunMembershipRef, qualityResultRefId, stageEvidenceRefId } from "./types";

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await promise };
  } catch {
    return { ok: false };
  }
}

/** Read only explicit dataset_id from Builder canonical spec snapshot. */
function datasetIdFromSpecSnapshot(spec: string): string | null {
  try {
    const parsed = parseYaml(spec) as unknown;
    if (!parsed || typeof parsed !== "object" || !("dataset_id" in parsed)) return null;
    const datasetId = (parsed as Record<string, unknown>).dataset_id;
    return typeof datasetId === "string" && datasetId.length > 0 ? datasetId : null;
  } catch {
    return null;
  }
}

/**
 * Load evidence for the current context.
 *
 * @param context - Context to compose evidence for (must be fixed at request start time).
 * @param signal - Abort signal.
 * @returns Evidence bundle with secrets removed, set of known IDs for response hallucination checks,
 *   and set of run IDs "confirmed to exist by Builder" that are exempt from egress entropy false positives.
 */
export async function loadAssistantEvidence(
  context: AssistantContext,
  signal?: AbortSignal,
): Promise<{
  evidence: AssistantEvidence;
  knownRefs: AssistantKnownRefs;
  safeRunIds: Set<string>;
  safeEvidenceIds: Set<string>;
}> {
  const unavailable: AssistantEvidenceSource[] = [];
  const evidence: AssistantEvidence = {
    fetchedAt: new Date().toISOString(),
    context,
    deepLinks: {},
    partial: false,
    unavailable: [],
  };
  const knownRefs: AssistantKnownRefs = {
    datasetIds: new Set(),
    runIds: new Set(),
    datasetRunMemberships: new Set(),
    providers: new Set(),
    qualityResultIds: new Set(),
    schemaDriftIds: new Set(),
    stageIds: new Set(),
    sourceKeys: new Set(),
  };

  // knownRefs.runIds and safeRunIds have different roles (former for crossCheck hallucination detection,
  // latter for LLM egress/redaction entropy false positive exemption), but provenance contract is the same:
  // both contain only run IDs "confirmed to exist" via Builder response in this evidence loading session.
  // route/context.runId is used only as evidence.context / deepLink / Builder query target; before existence
  // is confirmed, they are not added to either trust set. To keep both Sets in sync, confirmed runs must always
  // be registered through this helper.
  const safeRunIds = new Set<string>();

  // safeRunIds and provenance contract are the same (entropy false positives only excluded for exact value),
  // but targets differ: this set contains only evidence identifiers (qualityResultRefId / schema drift key)
  // that Studio deterministically derives from Builder `/quality` response fields. A canonical ID like
  // `datago.air_quality::completeness::min_rows::_` exceeds Shannon entropy threshold (4.0+) due to path
  // and character diversity, so if only safeRunIds is passed, redactSecrets would false-positively mark valid
  // quality IDs as `[REDACTED]`. Exemption is based on "exact characters actually created during this loading,"
  // not just form/pattern (e.g., `quality:` prefix). Never add values from user questions or model output.
  const safeEvidenceIds = new Set<string>();

  function confirmRunId(id: string | null | undefined): void {
    if (!id) return;
    knownRefs.runIds.add(id);
    safeRunIds.add(id);
  }

  const catalogResult = await settle(builderApi.catalog(signal));
  if (catalogResult.ok) {
    const datasetsByProvider: Record<string, string[]> = {};
    for (const provider of catalogResult.value.providers) {
      knownRefs.providers.add(provider.name);
      datasetsByProvider[provider.name] = provider.datasets.map((d) => d.name);
    }
    evidence.catalog = { providers: Object.keys(datasetsByProvider), datasetsByProvider };
  } else {
    unavailable.push("catalog");
  }

  let runId = context.runId;

  if (context.datasetId) {
    const [datasetResult, runsResult] = await Promise.all([
      settle(getDataset(context.datasetId, signal)),
      settle(listDatasetRuns(context.datasetId, 10, signal)),
    ]);

    if (datasetResult.ok) {
      const dataset = datasetResult.value;
      knownRefs.datasetIds.add(dataset.dataset_id);
      evidence.dataset = {
        datasetId: dataset.dataset_id,
        title: dataset.title,
        providers: dataset.sources.map((s) => s.provider),
        sources: dataset.sources.map((s) => ({ provider: s.provider, dataset: s.dataset })),
        latestRunId: dataset.latest_run_id,
        status: dataset.status,
        updatedAt: dataset.updated_at,
        totalRowCount: dataset.total_row_count,
      };
      // getDataset success response's latest_run_id — confirmed by Builder (schema declares string but
      // defensively filter out falsy values).
      confirmRunId(dataset.latest_run_id);
      if (dataset.latest_run_id) {
        knownRefs.datasetRunMemberships.add(datasetRunMembershipRef(dataset.dataset_id, dataset.latest_run_id));
      }
      evidence.deepLinks.datasetDetail = `/tables/${encodeURIComponent(dataset.dataset_id)}`;
      evidence.deepLinks.qualityCenter = `/quality?dataset=${encodeURIComponent(dataset.dataset_id)}`;
      runId = runId ?? dataset.latest_run_id;
    } else {
      unavailable.push("dataset");
    }

    if (runsResult.ok) {
      evidence.recentRuns = runsResult.value.runs.map((run) => ({
        runId: run.run_id,
        status: run.status,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
      }));
      // listDatasetRuns success response's run_id — directly returned by Builder, these are actual runs.
      for (const run of runsResult.value.runs) {
        confirmRunId(run.run_id);
        if (datasetResult.ok && datasetResult.value.dataset_id === context.datasetId) {
          knownRefs.datasetRunMemberships.add(datasetRunMembershipRef(datasetResult.value.dataset_id, run.run_id));
        }
      }
    } else {
      unavailable.push("runs");
    }
  }

  if (runId) {
     // If runId came from route/context (not already confirmed via dataset.latest_run_id), existence is
     // not yet confirmed. Used for deepLink calculation and Builder query target, but not added to knownRefs/
     // safeRunIds until below — getBuildQuality / listBuildStages respond with 404 for nonexistent runs
     // (Builder OpenAPI SSOT), so confirmRunId is called only when those requests return successfully.
    evidence.deepLinks.buildDetail = `/refresh-jobs/${encodeURIComponent(runId)}`;

    // Even if a run is older than the recent run-list window, Builder canonical spec snapshot directly
    // provides the dataset_id for each run. Query independently of other membership references, and
    // exclude this evidence source only if failure or parsing is impossible.
    const specSnapshotPromise = settle(getBuildSpecSnapshot(runId, signal));

    const storedSpec = loadBuildSpec(runId);
    if (storedSpec) {
      evidence.buildSpecSummary = {
        title: storedSpec.title,
        description: storedSpec.description,
        sources: storedSpec.sources.map((source) => ({
          provider: source.provider,
          dataset: source.dataset,
          alias: source.alias,
          paramKeys: Object.keys(source.params),
        })),
        exportFormats: storedSpec.exports.map((e) => e.format),
        metadataKeys: Object.keys(storedSpec.metadata),
      };
    }

    const qualityResult = await settle(getBuildQuality(runId, signal));
    if (qualityResult.ok) {
       // GET /builds/{run_id}/quality returns 404 for nonexistent run — if 200, this is an actual run.
      confirmRunId(runId);
      const quality = qualityResult.value;
      const results = Object.values(quality.quality_results).flat();
      const drift = Object.values(quality.schema_drift).flat();
      evidence.quality = {
        availability: quality.availability,
        evaluatedChecks: quality.evaluated_checks,
        results: results.map((result) => {
          const id = qualityResultRefId(result);
          knownRefs.qualityResultIds.add(id);
          safeEvidenceIds.add(id);
          knownRefs.sourceKeys.add(result.source_key);
          return {
            id,
            source: result.source_key,
            category: result.category,
            rule: result.rule,
            column: result.column,
            status: result.status,
            actual: result.actual,
            threshold: result.threshold,
            detail: result.detail,
          };
        }),
        schemaDrift: drift.map((finding) => {
          const driftId = `${finding.kind}::${finding.column ?? "_"}`;
          knownRefs.schemaDriftIds.add(driftId);
          safeEvidenceIds.add(driftId);
          return { kind: finding.kind, column: finding.column, detail: finding.detail };
        }),
      };
    } else {
      unavailable.push("quality");
    }

    const specSnapshotResult = await specSnapshotPromise;
    if (specSnapshotResult.ok && specSnapshotResult.value.run_id === runId) {
      const snapshotDatasetId = datasetIdFromSpecSnapshot(specSnapshotResult.value.spec);
      if (snapshotDatasetId) {
        confirmRunId(runId);
        knownRefs.datasetRunMemberships.add(datasetRunMembershipRef(snapshotDatasetId, runId));
      }
    }

     // Stage evidence is meaningful only when both source and stage exist in context. Do not infer the first
     // source from stage list if source is missing — principle: do not create evidence for what we cannot verify.
    if (context.stage) {
      const stagesResult = await settle(listBuildStages(runId, signal));
      if (stagesResult.ok) {
        // GET /builds/{run_id}/stages also returns 404 for nonexistent run — if 200, this is an actual run.
        confirmRunId(runId);
       // Every source_key in the stage list is an actual canonical source for this run — all are collected
       // so generated SQL source validation works even if quality evidence is missing.
        const sources = stagesResult.value.sources;
        for (const source of sources) knownRefs.sourceKeys.add(source.source_key);
         // Which source's stage to view: (1) if context.source selected on screen matches an actual source
         // in this run, use it; (2) if no selection and this run has exactly 1 source, use that unique source;
         // (3) otherwise (multiple sources but no selection / selection not in this run), fail-closed by not
         // selecting anything (consistent with P5 canonical source policy).
        const chosenSource = context.source
          ? sources.find((source) => source.source_key === context.source)
          : sources.length === 1
            ? sources[0]
            : undefined;
        if (chosenSource) {
           // Stage evidence uses only status/available/row_count metadata, not sample rows. Why: Builder's
           // `/builds/{run}/stages/{stage}` requires limit to be a positive integer up to 1000, returning
           // 400 for limit=0 (OpenAPI SSOT) — this was the real cause of stage evidence always failing in
           // Studio. Request minimum sample (1) to get metadata only.
          const detailResult = await settle(
            getBuildStageDetail(runId, context.stage, chosenSource.source_key, 1, signal),
          );
          if (detailResult.ok) {
            const detail = detailResult.value;
            const refId = stageEvidenceRefId(runId, chosenSource.source_key, detail.stage);
            const rowCount = detail.stage === "bronze" ? detail.record_count : detail.row_count;
            knownRefs.sourceKeys.add(chosenSource.source_key);
            knownRefs.stageIds.add(refId);
            safeEvidenceIds.add(refId);
             // So generated SQL cannot guess column names/types, expose only the stage schema already
             // returned by Builder canonically: silver includes {name,dtype}; gold includes name only
             // (dtype not in contract); bronze has neither. Do not read sample rows.
            let columns: string[] | undefined;
            let schema: { name: string; dtype: string }[] | undefined;
            if (detail.stage === "silver" && detail.schema.length > 0) {
              schema = detail.schema.map((column) => ({ name: column.name, dtype: column.dtype }));
              columns = schema.map((column) => column.name);
            } else if (detail.stage === "gold" && detail.columns.length > 0) {
              columns = [...detail.columns];
            }
            evidence.stage = {
              refId,
              stage: context.stage,
              source: chosenSource.source_key,
              status: detail.status,
              available: detail.available,
              rowCount,
              ...(columns ? { columns } : {}),
              ...(schema ? { schema } : {}),
            };
          } else {
            unavailable.push("stage");
          }
        } else {
          unavailable.push("stage");
        }
      } else {
        unavailable.push("stage");
      }
    }
  }

  evidence.unavailable = unavailable;
  evidence.partial = unavailable.length > 0;

  // Final defensive gate: if Builder response accidentally includes a credential-like field not caught
  // earlier, filter it here too. Entropy false positive exemption uses provenance-confirmed exact values —
  // safeRunIds (run IDs Builder confirmed exist) + safeEvidenceIds (evidence identifiers deterministically
  // derived from Builder `/quality` response) — only. Route context.runId and arbitrary character strings
  // not yet confirmed are in neither set, so evidence won't leak. Secret-name field masking applies
  // before this exemption (scrub.ts).
  const safeValues = new Set<string>([...safeRunIds, ...safeEvidenceIds]);
  const redacted = redactSecrets(evidence, safeValues) as AssistantEvidence;
  return { evidence: redacted, knownRefs, safeRunIds, safeEvidenceIds };
}
