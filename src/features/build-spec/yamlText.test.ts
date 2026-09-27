/**
 * Canonical BuildSpec GUI ↔ YAML round-trip test (#250, #251).
 */
import { describe, expect, it } from "vitest";
import { BuildSpecShapeError, YamlSyntaxError, fromYamlText, toYamlText } from "./yamlText";
import { serializeSpec, toBuilderSpec } from "./specMapping";
import type { BuildSpec } from "@/shared/lib/types";

const SPEC: BuildSpec = {
  datasetId: "seoul-air-quality",
  title: "서울 대기질 관측",
  description: "서울 지역 측정소별 대기오염 관측 데이터",
  sources: [{ provider: "datago", dataset: "air_quality", alias: "air", params: { sidoName: "서울" } }],
  exports: [{ format: "jsonl", options: { outputPath: "artifacts/air-quality.jsonl" } }],
  metadata: {},
};

describe("toYamlText/fromYamlText round-trip", () => {
  it("GUI → YAML → GUI 왕복이 canonical field를 유실하지 않는다", () => {
    const yamlText = toYamlText(SPEC);
    const restored = fromYamlText(yamlText);

    expect(restored.datasetId).toBe(SPEC.datasetId);
    expect(restored.title).toBe(SPEC.title);
    expect(restored.description).toBe(SPEC.description);
    expect(restored.sources[0]).toMatchObject({
      provider: "datago",
      dataset: "air_quality",
      alias: "air",
      params: { sidoName: "서울" },
    });
    expect(restored.exports[0]?.options?.outputPath).toBe("artifacts/air-quality.jsonl");
  });

  it("toYamlText는 실제 제출 payload(toBuilderSpec)와 동일한 값을 표현한다", () => {
    const yamlText = toYamlText(SPEC);
    const restored = fromYamlText(yamlText);

    expect(toBuilderSpec(restored)).toEqual(toBuilderSpec(SPEC));
  });

  it("file/url kind source도 왕복 보존한다", () => {
    const fileSpec: BuildSpec = {
      ...SPEC,
      sources: [{ kind: "file", uploadId: "upl_0123456789abcdef0123456789abcdef", format: "csv", params: {} }],
    };
    const restored = fromYamlText(toYamlText(fileSpec));
    expect(restored.sources[0]).toMatchObject({
      kind: "file",
      uploadId: "upl_0123456789abcdef0123456789abcdef",
      format: "csv",
    });
  });

  it("Studio가 모델링하지 않는 최상위 필드(publish 등)를 YAML round-trip에서 잃지 않는다", () => {
    const yamlText = `${toYamlText(SPEC)}\npublish: true\nlicense: CC-BY-4.0\n`;
    const restored = fromYamlText(yamlText);

    expect(restored.extra).toMatchObject({ publish: true, license: "CC-BY-4.0" });
    expect(serializeSpec(restored)).toContain('"publish":true');
    expect(serializeSpec(restored)).toContain('"license":"CC-BY-4.0"');
  });

  it("YAML 구문 오류는 YamlSyntaxError로 던진다(구조 오류와 구분)", () => {
    expect(() => fromYamlText("dataset_id: [unterminated")).toThrow(YamlSyntaxError);
  });

  it("파싱은 되지만 canonical 모양이 아니면 BuildSpecShapeError를 던진다", () => {
    expect(() => fromYamlText("just_a_string: true")).toThrow(BuildSpecShapeError);
  });

  it("sources가 비어 있으면 구조 오류로 처리한다", () => {
    const invalid = "dataset_id: x\ntitle: t\ndescription: d\nsources: []\nexports:\n  - kind: jsonl\n    output_path: out.jsonl\n";
    expect(() => fromYamlText(invalid)).toThrow(BuildSpecShapeError);
  });
});
