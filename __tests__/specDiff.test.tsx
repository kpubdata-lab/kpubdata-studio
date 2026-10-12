import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpecDiff } from "@/features/build-spec/components/SpecDiff";
import { diffSpecs } from "@/features/build-spec/specDiff";
import type { BuildSpec } from "@/shared/lib/types";

const base: BuildSpec = {
  datasetId: "apt-trade",
  title: "대기오염",
  description: "설명",
  sources: [{ provider: "datago", dataset: "air", params: { sidoName: "서울" } }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

describe("diffSpecs (#13)", () => {
  it("returns no changes for identical specs", () => {
    expect(diffSpecs(base, structuredClone(base))).toEqual([]);
  });

  it("detects changed, added and removed fields", () => {
    const after: BuildSpec = {
      ...base,
      title: "대기오염 v2", // changed
      sources: [{ provider: "datago", dataset: "air", params: { sidoName: "부산" } }], // changed param
      exports: [{ format: "jsonl" }, { format: "parquet" }], // added
      metadata: { license: "CC-BY" }, // added
    };
    const changes = diffSpecs(base, after);
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));

    expect(byPath["title"]).toMatchObject({ kind: "changed", before: "대기오염", after: "대기오염 v2" });
    expect(byPath["sources[0].params.sidoName"]).toMatchObject({ kind: "changed", after: "부산" });
    expect(byPath["exports[1].format"]).toMatchObject({ kind: "added", after: "parquet" });
    expect(byPath["metadata.license"]).toMatchObject({ kind: "added", after: "CC-BY" });
  });

  it("detects removed fields", () => {
    const after: BuildSpec = { ...base, sources: [] };
    const changes = diffSpecs(base, after);
    expect(changes.some((c) => c.kind === "removed" && c.path.startsWith("sources[0]"))).toBe(true);
  });
});

describe("SpecDiff component (#13)", () => {
  it("renders an empty state when specs are equal", () => {
    render(<SpecDiff before={base} after={structuredClone(base)} />);
    expect(screen.getByText("두 스펙에 차이가 없습니다")).toBeInTheDocument();
  });

  it("lists changed paths", () => {
    render(<SpecDiff before={base} after={{ ...base, title: "새 제목" }} />);
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText(/새 제목/)).toBeInTheDocument();
  });
});
