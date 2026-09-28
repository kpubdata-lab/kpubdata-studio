/**
 * Related dataset candidates (#256 issue checklist — "Related dataset candidates must come only
 * from actual `/catalog` evidence").
 *
 * The prototype's "related datasets" panel used hardcoded examples (e.g., BOK reference rate ×
 * ECOS). Here we compute candidates as a pure function using only `evidence.catalog` (the actual
 * Builder `/catalog` response) — no LLM involvement means no hallucination cross-check needed and
 * we cannot recommend non-existent providers/datasets.
 *
 * Only datasets from the same provider as the current dataset are considered "related". We do
 * not invent cross-provider relationships — we follow the evidence principle (#256 review §11,
 * same as context.ts).
 */
import type { AssistantEvidence } from "./types";

export interface AssistantRelatedDataset {
  provider: string;
  /** The Builder catalog's source dataset name (e.g. "air_quality"). Not a Studio dataset_id — do not provide deep links. */
  dataset: string;
}

/**
 * Compute candidates for "other catalog datasets from the same provider" from current evidence.
 *
 * @param evidence - The evidence bundle from this turn (catalog and dataset must both be queried for candidates).
 * @param limit - Maximum number of candidates to return.
 * @returns Candidates that exist in the catalog, excluding the current dataset itself (max `limit` items).
 */
export function relatedCatalogDatasets(evidence: AssistantEvidence, limit = 5): AssistantRelatedDataset[] {
  if (!evidence.catalog || !evidence.dataset) return [];

  const ownKeys = new Set(evidence.dataset.sources.map((s) => `${s.provider}::${s.dataset}`));
  const seen = new Set<string>();
  const candidates: AssistantRelatedDataset[] = [];

  for (const provider of evidence.dataset.providers) {
    const datasetNames = evidence.catalog.datasetsByProvider[provider] ?? [];
    for (const name of datasetNames) {
      const key = `${provider}::${name}`;
      if (ownKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ provider, dataset: name });
      if (candidates.length >= limit) return candidates;
    }
  }

  return candidates;
}
