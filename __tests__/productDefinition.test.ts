/**
 * One product definition, word for word, wherever Studio describes itself (#498).
 *
 * README, README.en, PRD and ROADMAP each had their own sentence — "visual workspace for
 * SQL analysis", "visual interface for build workflows", "web-based workshop for builds" —
 * and the PRD's non-goals excluded the analysis the README promised.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const KO =
  "한국 공공데이터를 수집하고, 출처와 이용 조건을 유지한 스냅샷으로 관리하며, 표와 SQL 로 분석하는 작업공간";
const EN =
  "a workspace for collecting Korean public data, keeping it as snapshots that carry their source and terms of use, and analysing it with tables and SQL";

const read = (name: string) => readFileSync(resolve(__dirname, "..", name), "utf8");

describe("product definition", () => {
  it.each(["README.md", "PRD.md", "ROADMAP.md"])("%s carries the Korean definition", (name) => {
    expect(read(name)).toContain(KO);
  });

  it.each(["README.en.md", "PRD.md"])("%s carries the English definition", (name) => {
    expect(read(name)).toContain(EN);
  });

  it("the PRD does not rule out the analysis the definition promises", () => {
    expect(read("PRD.md")).not.toMatch(/- Acting as a notebook or BI tool/);
  });
});
