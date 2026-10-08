/**
 * Discover (#249) API layer.
 *
 * Fetches Builder `GET /catalog` (the source provider/dataset catalogue) — a
 * different source from the already-built datasets list (`GET /datasets`,
 * `features/datasets/api`); never blend the two. `/datasets` is read here only to name,
 * per source, the tables made from it (#529).
 *
 * Whether a Builder or the demo answers is decided by the clients behind what this
 * asks (`./client`, and the datasets feature's own) and nowhere in this file (#794).
 */
import { listDatasetsPage } from "@/features/datasets/api";
import type { CatalogResponse, DatasetSummary } from "@/shared/lib/builderApi";
import { discoverClient } from "./client";

/** How many tables Catalog asks for when it looks up which tables a source made (#529). */
export const CREATED_TABLES_LIMIT = 100;

/**
 * The caller's tables, to say which were made from each catalog source (#529). `complete`
 * is true only when `total` shows the page holds every table — otherwise a source with no
 * match is unknown, not "none". An older Builder without `total` is not complete. The demo
 * sends its `total` as a Builder does, so the same rule reads it.
 */
export async function loadCreatedTables(signal?: AbortSignal): Promise<{ tables: DatasetSummary[]; complete: boolean }> {
  const { datasets, total } = await listDatasetsPage(CREATED_TABLES_LIMIT, signal);
  return { tables: datasets, complete: total !== undefined && total <= datasets.length };
}

/** GET /catalog — fetches the source provider/dataset catalogue (#249). */
export async function loadCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  return discoverClient().catalog(signal);
}
