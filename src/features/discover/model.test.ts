/**
 * Discover (#249) model-helper tests.
 */
import { describe, expect, it } from "vitest";
import type { CatalogResponse } from "@/shared/lib/builderApi";
import {
  computeProviderCounts,
  computeServiceKeyCount,
  flattenCatalog,
  matchesProviderFilter,
  matchesQuery,
  matchesServiceKeyFilter,
  uniqueProviders,
  type DiscoverEntry,
} from "./model";

const CATALOG: CatalogResponse = {
  providers: [
    {
      name: "datago",
      datasets: [
        dataset("air_quality", "대기오염 정보", true),
        dataset("dur_product_info", "DUR 품목정보", false),
      ],
    },
    {
      name: "seoul",
      datasets: [dataset("bike_rental", "따릉이 대여 현황", true)],
    },
  ],
};

function dataset(name: string, title: string, requiresServiceKey: boolean) {
  return {
    name,
    title,
    description: null,
    tags: [],
    source_url: null,
    representation: "api_json" as const,
    operations: ["list" as const],
    query_support: null,
    requires_service_key: requiresServiceKey,
  };
}

describe("flattenCatalog", () => {
  it("flattens every provider's datasets into one list, keeping the provider name attached", () => {
    const entries = flattenCatalog(CATALOG);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ provider: "datago", dataset: CATALOG.providers[0].datasets[0] });
    expect(entries[2]).toEqual({ provider: "seoul", dataset: CATALOG.providers[1].datasets[0] });
  });

  it("returns an empty array for an empty catalog (not a crash)", () => {
    expect(flattenCatalog({ providers: [] })).toEqual([]);
  });
});

describe("matchesQuery", () => {
  const entries = flattenCatalog(CATALOG);
  const airQuality = entries[0];

  it("matches by dataset name, title, or provider name, case-insensitively", () => {
    expect(matchesQuery(airQuality, "AIR_QUALITY")).toBe(true);
    expect(matchesQuery(airQuality, "대기오염")).toBe(true);
    expect(matchesQuery(airQuality, "DATAGO")).toBe(true);
  });

  it("does not match unrelated queries", () => {
    expect(matchesQuery(airQuality, "population")).toBe(false);
  });

  it("treats an empty/whitespace query as matching everything", () => {
    expect(matchesQuery(airQuality, "")).toBe(true);
    expect(matchesQuery(airQuality, "   ")).toBe(true);
  });
});

describe("matchesProviderFilter", () => {
  const entries = flattenCatalog(CATALOG);

  it("matches only the selected provider", () => {
    expect(matchesProviderFilter(entries[0], "datago")).toBe(true);
    expect(matchesProviderFilter(entries[0], "seoul")).toBe(false);
  });

  it("treats an empty selection as 전체(no filter)", () => {
    expect(matchesProviderFilter(entries[0], "")).toBe(true);
  });
});

describe("matchesServiceKeyFilter", () => {
  const entries = flattenCatalog(CATALOG);
  const requiresKey = entries[0]; // air_quality: true
  const noKey = entries[1]; // dur_product_info: false

  it("when off, passes everything regardless of requires_service_key", () => {
    expect(matchesServiceKeyFilter(requiresKey, false)).toBe(true);
    expect(matchesServiceKeyFilter(noKey, false)).toBe(true);
  });

  it("when on, keeps only datasets that require a service key", () => {
    expect(matchesServiceKeyFilter(requiresKey, true)).toBe(true);
    expect(matchesServiceKeyFilter(noKey, true)).toBe(false);
  });
});

describe("computeProviderCounts", () => {
  it("computes counts at runtime from the loaded entries, not from a hardcoded table", () => {
    const entries = flattenCatalog(CATALOG);
    const counts = computeProviderCounts(entries);
    expect(counts.get("datago")).toBe(2);
    expect(counts.get("seoul")).toBe(1);
    expect(counts.get("unknown-provider")).toBeUndefined();
  });

  it("returns an empty map for no entries", () => {
    expect(computeProviderCounts([])).toEqual(new Map());
  });

  it("reflects a differently-shaped catalog on a second call (not memoized/stale)", () => {
    const smaller: DiscoverEntry[] = [{ provider: "datago", dataset: CATALOG.providers[0].datasets[0] }];
    expect(computeProviderCounts(smaller).get("datago")).toBe(1);
  });
});

describe("uniqueProviders", () => {
  it("returns sorted, de-duplicated provider names", () => {
    const entries = flattenCatalog(CATALOG);
    expect(uniqueProviders(entries)).toEqual(["datago", "seoul"]);
  });

  it("returns an empty array when there are no entries", () => {
    expect(uniqueProviders([])).toEqual([]);
  });
});

describe("computeServiceKeyCount", () => {
  it("counts only entries with requires_service_key = true", () => {
    const entries = flattenCatalog(CATALOG);
    expect(computeServiceKeyCount(entries)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(computeServiceKeyCount([])).toBe(0);
  });
});
