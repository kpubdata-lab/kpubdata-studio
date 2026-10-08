/**
 * The discover client: one interface, and the two things that implement it (#794).
 *
 * As in `features/datasets/api/client.ts`: the screen asks `discoverClient()` and does
 * not know whether a Builder or the demo answers. `client.contract.test.ts` holds the two
 * to the same expectations.
 */
import { builderApi, isRealBuilderEnabled, type CatalogResponse } from "@/shared/lib/builderApi";

/**
 * What the Catalog screen asks for. `catalog` resolves with the source catalogue as
 * Builder's contract shapes it, and rejects, without an answer, when `signal` is already
 * aborted.
 */
export interface DiscoverClient {
  /** `GET /catalog` — the source providers and their datasets (#249). */
  catalog(signal?: AbortSignal): Promise<CatalogResponse>;
}

export const realDiscoverClient: DiscoverClient = {
  catalog: async (signal) => builderApi.catalog(signal),
};

/**
 * Deterministic fixture the demo answers `GET /catalog` with.
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

const DEMO_CATALOG: CatalogResponse = {
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

export const demoDiscoverClient: DiscoverClient = {
  async catalog(signal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    return DEMO_CATALOG;
  },
};

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function discoverClient(): DiscoverClient {
  return isRealBuilderEnabled() ? realDiscoverClient : demoDiscoverClient;
}
