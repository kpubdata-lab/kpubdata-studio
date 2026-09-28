/**
 * Discover (#249) pure model helpers.
 *
 * Only the logic for searching/filtering the Builder `/catalog` response
 * (per-provider dataset lists). Literal substring matching over
 * dataset/title/provider names — not natural-language search (Assistant, #256) —
 * the same interpretation as DatasetCatalogPage's "exact search".
 */
import type { CatalogDataset, CatalogResponse } from "@/shared/lib/builderApi";

/** Flattened item carrying provider and dataset together, one per card. */
export interface DiscoverEntry {
  provider: string;
  dataset: CatalogDataset;
}

/** Flattens the per-provider nested catalog response into a card-friendly list. */
export function flattenCatalog(catalog: CatalogResponse): DiscoverEntry[] {
  return catalog.providers.flatMap((provider) =>
    provider.datasets.map((dataset) => ({ provider: provider.name, dataset })),
  );
}

/** Case-insensitive substring match over dataset/title/provider names; empty query always passes. */
export function matchesQuery(entry: DiscoverEntry, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const haystack = `${entry.dataset.name} ${entry.dataset.title} ${entry.provider}`.toLocaleLowerCase();
  return haystack.includes(normalized);
}

/** Provider filter; empty string ("all") always passes. */
export function matchesProviderFilter(entry: DiscoverEntry, provider: string): boolean {
  return !provider || entry.provider === provider;
}

/** "requires service key only" filter; false always passes (filter off). */
export function matchesServiceKeyFilter(entry: DiscoverEntry, onlyRequiresKey: boolean): boolean {
  return !onlyRequiresKey || entry.dataset.requires_service_key;
}

/**
 * Computes per-provider dataset counts from the loaded catalog on demand —
 * no hardcoded provider lists/counts (#249 requirement).
 */
export function computeProviderCounts(entries: DiscoverEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.provider, (counts.get(entry.provider) ?? 0) + 1);
  }
  return counts;
}

/** Alphabetically sorted distinct providers across the catalog (filter options). */
export function uniqueProviders(entries: DiscoverEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.provider))).sort();
}

/** Count of requires_service_key=true items — shown on the "requires service key only" checkbox label. */
export function computeServiceKeyCount(entries: DiscoverEntry[]): number {
  return entries.filter((entry) => entry.dataset.requires_service_key).length;
}
