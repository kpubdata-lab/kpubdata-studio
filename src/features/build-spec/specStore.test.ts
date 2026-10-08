// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  SPEC_STORE_LIMIT,
  clearBuildSpecs,
  hasBuildSpec,
  loadBuildSpec,
  saveBuildSpec,
} from "./specStore";
import type { BuildSpec } from "@/shared/lib/types";

function makeSpec(overrides: Partial<BuildSpec> = {}): BuildSpec {
  return {
    datasetId: "air-quality",
    title: "대기오염 정보",
    description: "시도별 실시간 대기오염 측정값",
    sources: [{ provider: "datago", dataset: "air", params: { sidoName: "서울" } }],
    exports: [{ format: "jsonl" }],
    metadata: { outputPath: "artifacts/builds/air", source_url: "https://example.test" },
    ...overrides,
  };
}

describe("specStore", () => {
  beforeEach(() => {
    clearBuildSpecs();
  });

  it("저장한 스펙을 run id로 되돌려준다", () => {
    const spec = makeSpec();
    saveBuildSpec("run-1", spec);

    expect(loadBuildSpec("run-1")).toEqual(spec);
    expect(hasBuildSpec("run-1")).toBe(true);
  });

  it("여러 소스와 폼에 없는 메타데이터를 그대로 보존한다", () => {
    const spec = makeSpec({
      sources: [
        { provider: "datago", dataset: "air", params: {} },
        { provider: "datago", dataset: "water", params: { region: "busan" } },
      ],
      metadata: { outputPath: "out", hf_repo: "org/dataset", source_url: "https://example.test" },
    });
    saveBuildSpec("run-multi", spec);

    const loaded = loadBuildSpec("run-multi");
    expect(loaded?.sources).toHaveLength(2);
    expect(loaded?.metadata.hf_repo).toBe("org/dataset");
  });

  it("저장된 적 없는 run id는 null을 반환한다", () => {
    expect(loadBuildSpec("unknown")).toBeNull();
    expect(hasBuildSpec("unknown")).toBe(false);
  });

  it("빈 run id는 저장하지도 조회하지도 않는다", () => {
    saveBuildSpec("", makeSpec());
    expect(loadBuildSpec("")).toBeNull();
  });

  it("스키마를 통과하지 못하는 손상된 값은 버린다", () => {
    saveBuildSpec("run-broken", makeSpec());
    // Simulate corrupted spec after save (schema changed or value damaged).
    const raw = JSON.parse(localStorage.getItem("kpubdata-studio:build-specs") as string) as {
      entries: Record<string, { spec: unknown }>;
    };
    raw.entries["run-broken"].spec = { datasetId: 123 };
    localStorage.setItem("kpubdata-studio:build-specs", JSON.stringify(raw));

    expect(loadBuildSpec("run-broken")).toBeNull();
  });

  it("봉투 버전이 다르면 조용히 정리한다", () => {
    localStorage.setItem(
      "kpubdata-studio:build-specs",
      JSON.stringify({ version: 999, entries: { "run-1": { spec: makeSpec(), savedAt: "x" } } }),
    );

    expect(loadBuildSpec("run-1")).toBeNull();
    expect(localStorage.getItem("kpubdata-studio:build-specs")).toBeNull();
  });

  it("credential-like 값은 저장 전에 redact하고 정상 필드는 보존한다 (S07)", () => {
    const secret = "abcdef0123456789abcdef0123456789ABCDEF";
    const spec = makeSpec({
      sources: [
        {
          provider: "datago",
          dataset: "air",
          params: {
            sidoName: "서울",
            serviceKey: secret,
            nested: { api_key: secret, note: "keep-me" },
            list: [{ token: secret }, "plain-value"],
          },
        },
      ],
    });
    saveBuildSpec("run-secret", spec);

    const raw = localStorage.getItem("kpubdata-studio:build-specs") as string;
    expect(raw).not.toContain(secret);

    const loaded = loadBuildSpec("run-secret");
    const params = loaded?.sources[0].params as Record<string, unknown>;
    expect(params.sidoName).toBe("서울");
    expect(params.serviceKey).toBe("[REDACTED]");
    expect((params.nested as Record<string, unknown>).api_key).toBe("[REDACTED]");
    expect((params.nested as Record<string, unknown>).note).toBe("keep-me");
    expect((params.list as unknown[])[0]).toEqual({ token: "[REDACTED]" });
    expect((params.list as unknown[])[1]).toBe("plain-value");
    // Normal BuildSpec values are not corrupted.
    expect(loaded?.datasetId).toBe("air-quality");
    expect(loaded?.sources[0].provider).toBe("datago");
    expect(loaded?.metadata.source_url).toBe("https://example.test");
  });

  it("url source endpoint의 query credential은 저장 전에 redact한다 (S07)", () => {
    const spec = makeSpec({
      sources: [
        {
          kind: "url",
          dataset: "air",
          endpoint: "https://api.example.test/v1/data?serviceKey=super-secret-value&page=1",
          params: {},
        },
      ],
    });
    saveBuildSpec("run-url", spec);

    const raw = localStorage.getItem("kpubdata-studio:build-specs") as string;
    expect(raw).not.toContain("super-secret-value");

    const endpoint = loadBuildSpec("run-url")?.sources[0].endpoint ?? "";
    expect(endpoint).toContain("__KPD_URL_SECRET_REDACTED__");
    expect(endpoint).toContain("page=1");
    expect(endpoint).toContain("api.example.test");
  });

  it("in-memory spec 객체는 저장 시 변형되지 않는다 (S07)", () => {
    const secret = "abcdef0123456789abcdef0123456789ABCDEF";
    const spec = makeSpec({
      sources: [{ provider: "datago", dataset: "air", params: { serviceKey: secret } }],
    });
    saveBuildSpec("run-immutable", spec);
    // Ongoing Preview/Build requests use original as-is.
    expect(spec.sources[0].params.serviceKey).toBe(secret);
  });

  it("과거 버전이 저장한 평문 credential을 load 시점에 sanitize + rewrite한다 (S07 리뷰 §2)", () => {
    const secret = "abcdef0123456789abcdef0123456789ABCDEF";
    // Simulate pre-redaction format — plaintext serviceKey directly in envelope.
    const legacy = makeSpec({
      sources: [{ provider: "datago", dataset: "air", params: { sidoName: "서울", serviceKey: secret } }],
    });
    localStorage.setItem(
      "kpubdata-studio:build-specs",
      JSON.stringify({ version: 1, entries: { "run-legacy": { spec: legacy, savedAt: "2020-01-01T00:00:00.000Z" } } }),
    );

    const loaded = loadBuildSpec("run-legacy");
    // Loaded value has no raw secret (restored as redacted state only).
    expect((loaded?.sources[0].params as Record<string, unknown>).serviceKey).toBe("[REDACTED]");
    expect((loaded?.sources[0].params as Record<string, unknown>).sidoName).toBe("서울");
    expect(loaded?.datasetId).toBe("air-quality");

    // localStorage immediately sanitized; no raw secret persists.
    const raw = localStorage.getItem("kpubdata-studio:build-specs") as string;
    expect(raw).not.toContain(secret);
    expect(raw).toContain("[REDACTED]");
     // Other entry metadata (savedAt, etc.) is preserved.
    expect(JSON.parse(raw).entries["run-legacy"].savedAt).toBe("2020-01-01T00:00:00.000Z");
  });

  it("이미 sanitized된 entry는 load 시 값이 유지되고 불필요한 rewrite를 하지 않는다 (S07 리뷰 §2)", () => {
    const spec = makeSpec({
      sources: [{ provider: "datago", dataset: "air", params: { sidoName: "서울", serviceKey: "abcdef0123456789abcdef0123456789ABCDEF" } }],
    });
     saveBuildSpec("run-clean", spec); // Redaction happens at this point during save
    const afterSave = localStorage.getItem("kpubdata-studio:build-specs") as string;

    const loaded = loadBuildSpec("run-clean");
    expect((loaded?.sources[0].params as Record<string, unknown>).serviceKey).toBe("[REDACTED]");
    expect((loaded?.sources[0].params as Record<string, unknown>).sidoName).toBe("서울");
     // Load does not do destructive rewrite — byte-for-byte identical.
    expect(localStorage.getItem("kpubdata-studio:build-specs")).toBe(afterSave);
  });

  it("상한을 넘으면 오래된 항목부터 버린다", () => {
    for (let i = 0; i < SPEC_STORE_LIMIT + 5; i++) {
      saveBuildSpec(`run-${String(i).padStart(3, "0")}`, makeSpec({ datasetId: `ds-${i}` }));
    }

    // Oldest saved item is evicted; newest item remains.
    expect(loadBuildSpec("run-000")).toBeNull();
    expect(loadBuildSpec(`run-${String(SPEC_STORE_LIMIT + 4).padStart(3, "0")}`)).not.toBeNull();
  });
});
