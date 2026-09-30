/**
 * Discover (#249) API layer.
 *
 * Fetches Builder `GET /catalog` (the source provider/dataset catalogue) — a
 * different source from the already-built datasets list (`GET /datasets`,
 * `features/datasets/api`); never blend the two. `/datasets` is read here only to name,
 * per source, the tables made from it (#529).
 *
 * The mock/real branch follows the pattern `features/datasets/api` already
 * established: `builderApi.catalog()` itself has no mock branch (#246
 * principle — clearly separate mock/demo from real Builder), so this layer
 * splits on `isRealBuilderEnabled()`.
 */
import { listDatasets } from "@/features/datasets/api";
import { builderApi, isRealBuilderEnabled, type CatalogResponse, type DatasetSummary } from "@/shared/lib/builderApi";

/**
 * Deterministic fixture used in mock mode.
 *
 * Both requires_service_key true/false must be present to exercise the
 * badge/filter, and 2+ providers make the provider filter meaningful. As
 * Builder #490 rich metadata (description/tags/source_url etc.) entered the
 * catalog schema (#250), the fixture fills the entire schema too — P0
 * screens may not display it, but it cannot drift from the contract.
 */
function dataset(
  name: string,
  title: string,
  requiresServiceKey: boolean,
  description = null,
): CatalogResponse["providers"][number]["datasets"][number] {
  return {
    name,
    title,
    description,
    tags: [],
    source_url: null,
    representation: "api_json",
    operations: ["list"],
    query_support: null,
    requires_service_key: requiresServiceKey,
  };
}

const MOCK_CATALOG: CatalogResponse = {
  providers: [
    {
      name: "datago",
      datasets: [
        {
          ...dataset("air_quality", "대기오염 정보", true),
          application: { required: true, url: "https://www.data.go.kr/data/15073861/openapi.do" },
          quota: "개발계정 일 10,000건",
        },
        dataset("apt_trade", "아파트 실거래가", true),
        { ...dataset("dur_product_info", "DUR 품목정보", false), application: { required: false, url: "https://www.data.go.kr" } },
      ],
    },
    {
      name: "kosis",
      datasets: [
        dataset("population_stat", "인구총조사", false),
      ],
    },
    {
      name: "seoul",
      datasets: [
        dataset("bike_rental", "따릉이 대여 현황", true),
      ],
    },
  ],
};

/** How many tables Catalog asks for when it looks up which tables a source made (#529). */
export const CREATED_TABLES_LIMIT = 100;

/**
 * The caller's tables, to say which were made from each catalog source (#529). `complete`
 * is true only when Builder's `total` shows the page holds every table — otherwise a
 * source with no match is unknown, not "none". An older Builder without `total` is not
 * complete.
 */
export async function loadCreatedTables(signal?: AbortSignal): Promise<{ tables: DatasetSummary[]; complete: boolean }> {
  if (!isRealBuilderEnabled()) return { tables: await listDatasets(CREATED_TABLES_LIMIT, signal), complete: true };
  const { datasets, total } = await builderApi.listDatasets(CREATED_TABLES_LIMIT, signal);
  return { tables: datasets, complete: total !== undefined && total <= datasets.length };
}

/** GET /catalog — fetches the source provider/dataset catalogue (#249). */
export async function loadCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  if (isRealBuilderEnabled()) return builderApi.catalog(signal);
  return MOCK_CATALOG;
}
