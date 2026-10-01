/**
 * What the command palette (#533) can jump to besides pages: the caller's tables and the
 * catalog's sources.
 *
 * Both come from Builder lists the app already reads — `GET /datasets` for tables and
 * `GET /catalog` for sources — through the same feature loaders the Tables and Catalog
 * pages use, so mock mode and the real Builder behave alike. Each list loads on its own:
 * one failing leaves the other searchable.
 */
import { listDatasetsPage } from "@/features/datasets/api";
import { loadCatalog } from "@/features/discover/api";

/** How many tables the palette asks Builder for first. */
export const PALETTE_TABLE_LIMIT = 100;

/**
 * The most tables the palette ever asks for (#659). When Builder's `total` shows more than
 * the first page, the palette asks again with `limit` up to this many — `GET /datasets`
 * takes only `limit`, with no offset or query — and says so when even this is not all.
 */
export const PALETTE_TABLE_CEILING = 1000;

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

/** A list the palette loads; while it reloads, the last loaded value stays (#659). */
export type Loadable<V> = { status: "loading" } | { status: "loaded"; value: V } | { status: "error" };

/** The tables the palette searches, and how many the caller has in all. */
export interface TableIndex {
  entries: TableEntry[];
  /** Builder's `total`; undefined when this Builder does not send it. */
  total: number | undefined;
  /** False when the caller has tables the palette did not load (or may have, without `total`). */
  complete: boolean;
}

/**
 * The caller's tables, as the Tables list names them (#659). Asks for the first
 * {@link PALETTE_TABLE_LIMIT}; when `total` shows more, asks once more for up to
 * {@link PALETTE_TABLE_CEILING}, so tables past the first hundred are searchable too.
 */
export async function loadTableIndex(signal?: AbortSignal): Promise<TableIndex> {
  let page = await listDatasetsPage(PALETTE_TABLE_LIMIT, signal);
  if (page.total !== undefined && page.total > page.datasets.length && page.datasets.length >= PALETTE_TABLE_LIMIT) {
    page = await listDatasetsPage(Math.min(page.total, PALETTE_TABLE_CEILING), signal);
  }
  const { datasets, total } = page;
  return {
    entries: datasets.map((dataset) => ({
      datasetId: dataset.dataset_id,
      title: dataset.title,
      sourceText: dataset.sources.map((source) => `${source.provider} ${source.dataset} ${source.alias}`).join(" "),
    })),
    total,
    // Without `total`, a full page may have left tables out.
    complete: total !== undefined ? total <= datasets.length : datasets.length < PALETTE_TABLE_LIMIT,
  };
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
