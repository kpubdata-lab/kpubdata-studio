/**
 * Cross-check structured response against evidence/catalog to filter hallucinations (#256).
 *
 * Stage 2 of 4-gate validation. Zod only verified "shape"; here we cross-check all cited ids
 * (dataset/run/provider/quality results/schema drift) against actual evidence in this load.
 * Non-existent references don't discard entire answer — remove only that item, letting
 * user see parts actually grounded in evidence.
 */
import type { AssistantEvidence, AssistantEvidenceRef, AssistantKnownRefs, AssistantStructuredResponse } from "./types";
import { datasetRunMembershipRef } from "./types";
import type { AssistantAction } from "./schema";
import { i18n } from "@/shared/i18n";

/** All text strings in this file under `assistant.crossCheck.*` (#350). */
const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(`assistant.crossCheck.${key}`, params ?? {});

export interface CrossCheckResult {
  response: AssistantStructuredResponse;
  /** Rejected evidenceRef description (show user "evidence not confirmed, excluded"). */
  rejectedRefs: string[];
  /** Rejected suggestedAction description. */
  rejectedActions: string[];
  /** Reason if generatedSql was rejected. */
  rejectedSqlReason?: string;
}

function isKnownEvidenceRef(ref: AssistantEvidenceRef, known: AssistantKnownRefs, evidence: AssistantEvidence): boolean {
  switch (ref.kind) {
    case "dataset":
      return known.datasetIds.has(ref.id);
    case "run":
      return known.runIds.has(ref.id);
    case "catalog":
      return known.providers.has(ref.id);
    case "quality":
      return known.qualityResultIds.has(ref.id);
    case "schema_drift":
      return known.schemaDriftIds.has(ref.id);
    case "stage":
      return known.stageIds.has(ref.id) && evidence.stage?.refId === ref.id;
    default:
      return false;
  }
}

function isKnownAction(
  action: AssistantAction,
  known: AssistantKnownRefs,
  evidence: AssistantEvidence,
): { ok: true } | { ok: false; reason: string } {
  switch (action.type) {
    case "OPEN_PROVIDER":
      return known.providers.has(action.provider)
        ? { ok: true }
        : { ok: false, reason: t("openProviderUnknown", { provider: action.provider }) };
    case "OPEN_BUILD":
      return known.runIds.has(action.runId)
        ? { ok: true }
        : { ok: false, reason: t("openBuildUnknown", { runId: action.runId }) };
    case "OPEN_QUALITY":
      if (!known.datasetIds.has(action.datasetId)) {
        return { ok: false, reason: t("openQualityUnknownDataset", { datasetId: action.datasetId }) };
      }
      if (action.runId && !known.runIds.has(action.runId)) {
        return { ok: false, reason: t("openQualityUnknownRun", { runId: action.runId }) };
      }
      if (action.runId && !known.datasetRunMemberships.has(datasetRunMembershipRef(action.datasetId, action.runId))) {
        return {
          ok: false,
          reason: t("openQualityMismatch", { runId: action.runId, datasetId: action.datasetId }),
        };
      }
      return { ok: true };
    case "PATCH_BUILDSPEC":
      if (!known.runIds.has(action.runId)) {
        return { ok: false, reason: t("patchUnknownRun", { runId: action.runId }) };
      }
      if (!evidence.buildSpecSummary) {
        return {
          ok: false,
          reason: t("patchSpecMissing", { runId: action.runId }),
        };
      }
      return { ok: true };
    case "CREATE_BUILD_DRAFT": {
      if (!known.providers.has(action.values.provider)) {
        return { ok: false, reason: t("draftUnknownProvider", { provider: action.values.provider }) };
      }
      const knownDatasets = evidence.catalog?.datasetsByProvider[action.values.provider] ?? [];
      if (!knownDatasets.includes(action.values.sourceDataset)) {
        return {
          ok: false,
          reason: t("draftUnknownDataset", { provider: action.values.provider, dataset: action.values.sourceDataset }),
        };
      }
      return { ok: true };
    }
    case "ADD_REPORT_BLOCK":
      // Free-form note, no resource id to cross-check — zod pass alone sufficient.
      return { ok: true };
  }
}

/**
 * Cross-check structured response against evidence/catalog to remove hallucinated items.
 *
 * @param response - Structured response passed zod validation.
 * @param evidence - Evidence bundle used for this request.
 * @param knownRefs - "Actually existing" id set extracted from evidence.
 * @returns Response with only validated items and list of removed items.
 */
export function crossCheckAssistantResponse(
  response: AssistantStructuredResponse,
  evidence: AssistantEvidence,
  knownRefs: AssistantKnownRefs,
): CrossCheckResult {
  const rejectedRefs: string[] = [];
  const evidenceRefs = response.evidenceRefs.filter((ref) => {
    const known = isKnownEvidenceRef(ref, knownRefs, evidence);
    if (!known) rejectedRefs.push(`${ref.kind}:${ref.id} (${ref.label})`);
    return known;
  });

  const rejectedActions: string[] = [];
  const suggestedActions = response.suggestedActions.filter((action) => {
    const check = isKnownAction(action, knownRefs, evidence);
    if (!check.ok) rejectedActions.push(check.reason);
    return check.ok;
  });

  let generatedSql = response.generatedSql;
  let rejectedSqlReason: string | undefined;
  if (generatedSql) {
    if (evidence.context.stage !== generatedSql.stage) {
      rejectedSqlReason = t("sqlStageMismatch", {
        current: evidence.context.stage ?? t("stageNone"),
        proposed: generatedSql.stage,
      });
      generatedSql = null;
    } else if (generatedSql.source && !knownRefs.sourceKeys.has(generatedSql.source)) {
      // LLM-provided source string doesn't exactly match evidence's canonical source_key.
      // Don't guess normalization like "__"→"." — cross-check against canonical evidence only.
      // (Even without evidence.stage, quality result/stage lists all validated via knownRefs.sourceKeys.)
      const singleSource = knownRefs.sourceKeys.size === 1 || evidence.dataset?.sources.length === 1;
      if (singleSource) {
        // Single-source run with no ambiguity — drop unvalidated source, let Builder auto-select sole source (SQL body preserved).
        rejectedSqlReason = t("sqlSourceDropped", { source: generatedSql.source });
        generatedSql = { ...generatedSql, source: undefined };
      } else {
        // Multi-source: unvalidated source can't determine which to query — fail-closed.
        rejectedSqlReason = t("sqlSourceUnknown", { source: generatedSql.source });
        generatedSql = null;
      }
    }
  }

  return {
    response: { answer: response.answer, evidenceRefs, generatedSql, suggestedActions },
    rejectedRefs,
    rejectedActions,
    rejectedSqlReason,
  };
}
