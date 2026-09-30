/**
 * What the command palette (#533) can jump to besides pages: the caller's tables and the
 * catalog's sources.
 *
 * Both come from Builder lists the app already reads — `GET /datasets` for tables and
 * `GET /catalog` for sources — through the same feature loaders the Tables and Catalog
 * pages use, so mock mode and the real Builder behave alike. Each list loads on its own:
 * one failing leaves the other searchable.
 */
import { listDatasets } from "@/features/datasets/api";
import { loadCatalog } from "@/features/discover/api";

/** How many tables the palette asks Builder for. */
export const PALETTE_TABLE_LIMIT = 100;

/** How many hits of one kind the palette shows, so one kind never pushes the others out. */
export const PALETTE_GROUP_LIMIT = 5;

export interface TableEntry {
  datasetId: string;
  title: string;
  /** `provider dataset alias` of every source, matched as well as the name. */
  sourceText: string;
}

export interface SourceEntry {
  provider: string;
  name: string;
  title: string;
}

export type Loadable<T> = { status: "loading" } | { status: "loaded"; items: T[] } | { status: "error" };

/** The caller's tables, as the Tables list names them. */
export async function loadTableEntries(signal?: AbortSignal): Promise<TableEntry[]> {
  const datasets = await listDatasets(PALETTE_TABLE_LIMIT, signal);
  return datasets.map((dataset) => ({
    datasetId: dataset.dataset_id,
    title: dataset.title,
    sourceText: dataset.sources.map((source) => `${source.provider} ${source.dataset} ${source.alias}`).join(" "),
  }));
}

/** Every catalog source, provider by provider. */
export async function loadSourceEntries(signal?: AbortSignal): Promise<SourceEntry[]> {
  const catalog = await loadCatalog(signal);
  return catalog.providers.flatMap((provider) =>
    provider.datasets.map((dataset) => ({ provider: provider.name, name: dataset.name, title: dataset.title })),
  );
}

function matches(needle: string, ...values: string[]): boolean {
  return values.some((value) => value.toLocaleLowerCase().includes(needle));
}

/** Tables whose id, name or sources contain the query, at most {@link PALETTE_GROUP_LIMIT}. */
export function matchTables(entries: TableEntry[], query: string): TableEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return entries.filter((entry) => matches(needle, entry.datasetId, entry.title, entry.sourceText)).slice(0, PALETTE_GROUP_LIMIT);
}

/** Sources whose provider, name or title contain the query, at most {@link PALETTE_GROUP_LIMIT}. */
export function matchSources(entries: SourceEntry[], query: string): SourceEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return entries
    .filter((entry) => matches(needle, entry.provider, entry.name, entry.title, `${entry.provider}.${entry.name}`))
    .slice(0, PALETTE_GROUP_LIMIT);
}
