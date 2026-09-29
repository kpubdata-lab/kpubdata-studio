import { describe, expect, it } from "vitest";

import type { CatalogResponse } from "@/shared/lib/builderApi";

import { buildApplicationGuide } from "./applicationGuide";

function ds(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    title: name.toUpperCase(),
    description: null,
    tags: [],
    source_url: null,
    representation: "api_json" as const,
    operations: ["list" as const],
    query_support: null,
    requires_service_key: true,
    ...extra,
  };
}

const SHARED = "https://www.data.go.kr/data/1/openapi.do";

const CATALOG: CatalogResponse = {
  providers: [
    {
      name: "datago",
      datasets: [
        ds("a", { application: { required: true, url: SHARED }, quota: "개발계정 일 10,000건" }),
        ds("b", { application: { required: true, url: SHARED } }),
        ds("c", { application: { required: true, url: "https://www.data.go.kr/data/2/openapi.do" }, quota: null }),
        ds("d", { application: { required: false, url: "https://www.data.go.kr" } }),
        ds("e", { application: null }),
        ds("f"),
      ],
    },
  ],
};

describe("buildApplicationGuide (#412)", () => {
  const guide = buildApplicationGuide(CATALOG);

  it("gives every dataset that needs an application a row with its link", () => {
    const listed = guide.groups.flatMap((group) => group.datasets.map((d) => d.name)).sort();
    expect(listed).toEqual(["a", "b", "c"]);
    for (const group of guide.groups) expect(group.url).toMatch(/^https:\/\//);
  });

  it("puts datasets approved on the same page in one row", () => {
    expect(guide.groups[0]).toMatchObject({ provider: "datago", url: SHARED });
    expect(guide.groups[0].datasets.map((d) => d.name)).toEqual(["a", "b"]);
  });

  it("keeps a stated quota verbatim and an unstated one as unknown, never zero", () => {
    const quotas = Object.fromEntries(guide.groups.flatMap((g) => g.datasets.map((d) => [d.name, d.quota])));
    expect(quotas).toEqual({ a: "개발계정 일 10,000건", b: null, c: null });
  });

  it("counts datasets that do not say, instead of treating them as not needing one", () => {
    expect(guide.unknownCount).toBe(2);
  });
});
