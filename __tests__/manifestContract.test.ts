/**
 * BuildManifest 타입 ↔ Builder manifest 와이어 형태 정합성 테스트 (#98).
 *
 * Builder `manifest/writer.py`가 디스크에 기록하는 JSON payload를 그대로 Studio의 BuildManifest로
 * 받아도 타입 오류 없이 모든 필드가 매핑되는지 고정한다. 한쪽 구조가 바뀌면 컴파일/테스트가 깨져
 * 크로스 레포 불일치를 조기에 잡는다. (이전 camelCase·recordCount 단일 합계 형태는 실제 출력과 달랐다.)
 */
import { describe, expect, it } from "vitest";
import type { BuildManifest } from "@/shared/lib/types";

// Builder manifest/writer.py payload 그대로(snake_case, 정렬 키).
const WIRE_MANIFEST: BuildManifest = {
  schema_version: "1.0.0",
  build_id: "run-apt-trade-1",
  started_at: "2026-06-21T00:00:00+00:00",
  finished_at: "2026-06-21T00:00:08+00:00",
  build_environment: {
    python_version: "3.12.3",
    kpubdata_version: "0.4.0",
    builder_version: "0.4.0",
  },
  inputs: ["datago.apt-trade"],
  inputs_fingerprint: "sha256:abc",
  outputs: ["artifacts/builds/run-apt-trade-1/data.jsonl"],
  warnings: [],
  errors: [],
  row_counts: { "datago.apt-trade": 12304 },
  schema_summaries: {
    "datago.apt-trade": {
      fields: [{ name: "sidoName", type: "string", nullable: false }],
      total_fields: 1,
    },
  },
  provenance: [
    {
      provider: "datago",
      dataset: "apt-trade",
      fetched_at: "2026-06-21T00:00:05+00:00",
      record_count: 12304,
      data_checksum: "sha256:def",
      api_version: "unknown",
      params: { sidoName: "서울" },
    },
  ],
};

describe("BuildManifest contract (#98)", () => {
  it("accepts the real Builder manifest wire shape with all fields populated", () => {
    expect(WIRE_MANIFEST.build_id).toBe("run-apt-trade-1");
    expect(WIRE_MANIFEST.row_counts!["datago.apt-trade"]).toBe(12304);
    expect(WIRE_MANIFEST.schema_summaries!["datago.apt-trade"].total_fields).toBe(1);
    expect(WIRE_MANIFEST.provenance![0].data_checksum).toBe("sha256:def");
    expect(WIRE_MANIFEST.build_environment?.builder_version).toBe("0.4.0");
  });

  it("allows null build_environment and inputs_fingerprint (no inputs case)", () => {
    const empty: BuildManifest = {
      ...WIRE_MANIFEST,
      build_environment: null,
      inputs: [],
      inputs_fingerprint: null,
      row_counts: {},
      schema_summaries: {},
      provenance: [],
    };
    expect(empty.build_environment).toBeNull();
    expect(empty.inputs_fingerprint).toBeNull();
  });

  it("allows undefined for optional fields when not provided by API (#119)", () => {
    const minimal: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "run-minimal",
      build_environment: null,
      inputs_fingerprint: null,
      // 모든 optional 필드는 undefined로 남겨서 미제공 상태를 표현
      // started_at, finished_at, inputs, outputs, warnings, errors, row_counts, schema_summaries, provenance
    };
    expect(minimal.schema_version).toBe("1.0.0");
    expect(minimal.build_id).toBe("run-minimal");
    expect(minimal.started_at).toBeUndefined();
    expect(minimal.finished_at).toBeUndefined();
    expect(minimal.inputs).toBeUndefined();
    expect(minimal.outputs).toBeUndefined();
    expect(minimal.warnings).toBeUndefined();
    expect(minimal.errors).toBeUndefined();
    expect(minimal.row_counts).toBeUndefined();
    expect(minimal.schema_summaries).toBeUndefined();
    expect(minimal.provenance).toBeUndefined();
  });

  it("distinguishes between empty array and undefined array (#119)", () => {
    const empty: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "run-empty",
      build_environment: null,
      inputs_fingerprint: null,
      inputs: [], // 빈 배열 - 명시적으로 제공됨
      outputs: [], // 빈 배열 - 명시적으로 제공됨
      warnings: [], // 빈 배열 - 명시적으로 제공됨
      errors: [], // 빈 배열 - 명시적으로 제공됨
      provenance: [], // 빈 배열 - 명시적으로 제공됨
    };

    const missing: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "run-missing",
      build_environment: null,
      inputs_fingerprint: null,
      // 이 필드들은 undefined로 미제공 상태를 표현
    };

    expect(empty.inputs).toEqual([]);
    expect(empty.outputs).toEqual([]);
    expect(empty.warnings).toEqual([]);
    expect(empty.errors).toEqual([]);
    expect(empty.provenance).toEqual([]);

    expect(missing.inputs).toBeUndefined();
    expect(missing.outputs).toBeUndefined();
    expect(missing.warnings).toBeUndefined();
    expect(missing.errors).toBeUndefined();
    expect(missing.provenance).toBeUndefined();
  });

  it("distinguishes between zero record count and undefined row_counts (#119)", () => {
    const zeroRecords: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "run-zero",
      build_environment: null,
      inputs_fingerprint: null,
      row_counts: { "source.key": 0 }, // 실제 레코드 0건
    };

    const missingRecords: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "run-missing",
      build_environment: null,
      inputs_fingerprint: null,
      // row_counts 미제공
    };

    expect(zeroRecords.row_counts).toEqual({ "source.key": 0 });
    expect(missingRecords.row_counts).toBeUndefined();
  });
});
