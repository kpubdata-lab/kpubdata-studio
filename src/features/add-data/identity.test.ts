import { describe, expect, it } from "vitest";
import { datasetIdFromParts, findDataset, findProvider, identityFromCatalog, identityFromFilename, identityFromUrl, slugify } from "./identity";
import type { CatalogDataset, CatalogProvider } from "@/shared/lib/builderApi";

function dataset(overrides: Partial<CatalogDataset> = {}): CatalogDataset {
  return {
    name: "apt_trade",
    title: "아파트 실거래가",
    description: "국토교통부 아파트 매매 실거래가 조회",
    tags: [],
    source_url: null,
    representation: "api_json",
    operations: ["list"],
    query_support: null,
    requires_service_key: false,
    ...overrides,
  };
}

describe("slugify/datasetIdFromParts", () => {
  it("Replaces disallowed characters with -, removes leading/trailing -", () => {
    expect(slugify("Air Quality (2026)!!")).toBe("air-quality-2026");
  });

  it("Empty input returns fallback", () => {
    expect(slugify("   ")).toBe("dataset");
  });

  it("Joins multiple parts and slugifies", () => {
    expect(datasetIdFromParts("datago", "apt_trade")).toBe("datago-apt-trade");
  });
});

describe("identityFromCatalog (Public API, #250 amendment 2)", () => {
  it("Deterministic dataset_id from provider+dataset name, catalog title/description as-is", () => {
    const identity = identityFromCatalog("datago", dataset());
    expect(identity.datasetId).toBe("datago-apt-trade");
    expect(identity.title).toBe("아파트 실거래가");
    expect(identity.description).toBe("국토교통부 아파트 매매 실거래가 조회");
  });

  it("If catalog description null, use factual default (source only, don't fabricate)", () => {
    const identity = identityFromCatalog("datago", dataset({ description: null }));
    expect(identity.description).toBe("datago/apt_trade 데이터셋입니다.");
  });
});

describe("identityFromFilename (File, #250 amendment 2)", () => {
  it("Removes extension, uses normalized slug as dataset_id", () => {
    expect(identityFromFilename("2026 Apt Trades.csv").datasetId).toBe("2026-apt-trades");
  });

  it("Title formatted human-readable", () => {
    expect(identityFromFilename("apt_trade_seoul.jsonl").title).toBe("Apt Trade Seoul");
  });
});

describe("identityFromUrl (URL, #250 amendment 2)", () => {
  it("Creates dataset_id/title from hostname+path only", () => {
    const identity = identityFromUrl("https://api.example.org/v1/air-quality");
    expect(identity.datasetId).toBe("api-example-org-v1-air-quality");
  });

  it("Query string not included in identity", () => {
    const withQuery = identityFromUrl("https://api.example.org/v1/air-quality?token=SECRET&region=seoul");
    const withoutQuery = identityFromUrl("https://api.example.org/v1/air-quality");
    expect(withQuery.datasetId).toBe(withoutQuery.datasetId);
    expect(withQuery.datasetId).not.toMatch(/secret|token/i);
  });

  it("Credential (user:pass@host) not included in identity", () => {
    const identity = identityFromUrl("https://user:s3cr3t@api.example.org/data");
    expect(identity.datasetId).not.toMatch(/user|s3cr3t/i);
  });

  it("Invalid URL returns empty identity", () => {
    expect(identityFromUrl("not-a-url")).toEqual({ datasetId: "", title: "", description: "" });
  });

  it("Description also uses base without query string/credential", () => {
    const identity = identityFromUrl("https://user:s3cr3t@api.example.org/data?token=SECRET");
    expect(identity.description).not.toMatch(/secret|token|s3cr3t/i);
  });

  // #250 final verification §2: Description "URL object doesn't hold credential/query"
  // is wrong — `new URL(...)` preserves username/password/search/hash as-is
  // (readable via `url.username`/`url.password`/`url.search`/`url.hash`). Actual
  // safety comes from identityFromUrl using only `url.hostname`/`url.pathname` via
  // allowlist, not from URL object not holding those values. Below verifies that
  // allowlist behavior with credential+query+fragment all mixed in.
  it("Even with username/password/query/fragment, URL object preserves them, but not in dataset identity", () => {
    const endpoint = "https://user:secret@example.com/api/data?token=abc#section";
    const url = new URL(endpoint);
    // Prerequisite check: URL object actually holds credential/query/fragment.
    expect(url.username).toBe("user");
    expect(url.password).toBe("secret");
    expect(url.search).toBe("?token=abc");
    expect(url.hash).toBe("#section");

    // Safety comes from identityFromUrl using only hostname+pathname.
    const identity = identityFromUrl(endpoint);
    const serialized = `${identity.datasetId} ${identity.title} ${identity.description}`;
    expect(serialized).not.toMatch(/user|secret|token|abc|section/i);
    expect(identity.datasetId).toBe("example-com-api-data");
  });
});

describe("findProvider/findDataset", () => {
  const providers: CatalogProvider[] = [{ name: "datago", datasets: [dataset()] }];

  it("Finds provider/dataset by name", () => {
    expect(findProvider(providers, "datago")?.name).toBe("datago");
    expect(findDataset(providers, "datago", "apt_trade")?.title).toBe("아파트 실거래가");
  });

  it("Returns undefined if name not found", () => {
    expect(findDataset(providers, "datago", "missing")).toBeUndefined();
  });
});
