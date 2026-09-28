/**
 * Discover (#249) API layer.
 *
 * Fetches Builder `GET /catalog` (the source provider/dataset catalogue) — a
 * different source from the already-built datasets list (`GET /datasets`,
 * `features/datasets/api`); never blend the two.
 *
 * The mock/real branch follows the pattern `features/datasets/api` already
 * established: `builderApi.catalog()` itself has no mock branch (#246
 * principle — clearly separate mock/demo from real Builder), so this layer
 * splits on `isRealBuilderEnabled()`.
 */
import { builderApi, isRealBuilderEnabled, type CatalogResponse } from "@/shared/lib/builderApi";

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
        dataset("air_quality", "대기오염 정보", true),
        dataset("apt_trade", "아파트 실거래가", true),
        dataset("dur_product_info", "DUR 품목정보", false),
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

/** GET /catalog — fetches the source provider/dataset catalogue (#249). */
export async function loadCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  if (isRealBuilderEnabled()) return builderApi.catalog(signal);
  return MOCK_CATALOG;
}
