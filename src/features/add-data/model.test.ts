import { describe, expect, it } from "vitest";
import {
  INITIAL_DRAFT,
  applyBuildSpecToDraft,
  buildEditableSpecFromDraft,
  buildSpecFromDraft,
  draftSignature,
  redactBuildSpecForDisplay,
  type AddDataDraft,
} from "./model";
import { REDACTED_PLACEHOLDER } from "./urlRedaction";
import { PARAMS_REDACTED_SENTINEL } from "./paramsRedaction";
import type { BuildSpec } from "@/shared/lib/types";

function draftWith(overrides: Partial<AddDataDraft>): AddDataDraft {
  return { ...INITIAL_DRAFT, datasetId: "d", title: "t", description: "desc", ...overrides };
}

describe("buildSpecFromDraft", () => {
  it("소스를 선택하지 않으면 오류를 반환한다", () => {
    const result = buildSpecFromDraft(INITIAL_DRAFT);
    expect(result.error).toMatch(/Source를 먼저 선택/);
    expect(result.spec).toBeUndefined();
  });

  it("public_api: provider/dataset/params로 유효한 spec을 만든다", () => {
    const draft = draftWith({
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: '{"region":"seoul"}' },
    });
    const result = buildSpecFromDraft(draft);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).toMatchObject({
      provider: "datago",
      dataset: "apt_trade",
      params: { region: "seoul" },
    });
  });

  it("public_api: 잘못된 JSON 파라미터는 오류를 반환한다", () => {
    const draft = draftWith({
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{not json" },
    });
    expect(buildSpecFromDraft(draft).error).toMatch(/JSON/);
  });

  it("file: 업로드 전이면 오류를 반환한다", () => {
    const draft = draftWith({ sourceKind: "file" });
    expect(buildSpecFromDraft(draft).error).toMatch(/파일을 업로드/);
  });

  it("file: upload_id/format이 있으면 kind='file' spec을 만든다", () => {
    const draft = draftWith({
      sourceKind: "file",
      file: { uploadId: "upl_0123456789abcdef0123456789abcdef", format: "csv", encoding: "utf-8", filename: "a.csv", sizeBytes: 10 },
    });
    const result = buildSpecFromDraft(draft);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).toMatchObject({
      kind: "file",
      uploadId: "upl_0123456789abcdef0123456789abcdef",
      format: "csv",
    });
  });

  it("url: https가 아니면 오류를 반환한다", () => {
    const draft = draftWith({ sourceKind: "url", url: { endpoint: "http://insecure.example.org", format: null } });
    expect(buildSpecFromDraft(draft).error).toMatch(/https/);
  });

  it("url: https endpoint면 kind='url' spec을 만든다(Auth 필드 없음)", () => {
    const draft = draftWith({ sourceKind: "url", url: { endpoint: "https://api.example.org/data", format: "json" } });
    const result = buildSpecFromDraft(draft);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).toMatchObject({
      kind: "url",
      endpoint: "https://api.example.org/data",
      method: "GET",
      format: "json",
    });
    expect(result.spec?.sources[0]).not.toHaveProperty("timeout");
  });

  it("url: redact된 secret placeholder가 남은 endpoint는 fail-closed로 재입력을 요구한다 (#283, Epic #246)", () => {
    const draft = draftWith({
      sourceKind: "url",
      url: { endpoint: `https://api.example.org/data?api_key=${REDACTED_PLACEHOLDER}`, format: null },
    });
    const result = buildSpecFromDraft(draft);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/다시 입력/);
  });

  it("url: 정상 query parameter 값이 우연히 sentinel과 같은 뜻의 흔한 단어('REDACTED')여도 오인하지 않는다 (#283 후속 리뷰 §3)", () => {
    const draft = draftWith({
      sourceKind: "url",
      url: { endpoint: "https://api.example.org/data?status=REDACTED", format: null },
    });
    const result = buildSpecFromDraft(draft);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).toMatchObject({ endpoint: "https://api.example.org/data?status=REDACTED" });
  });

  it("url: userinfo credential(user:pass@host)이 포함된 endpoint는 fail-closed로 거부한다 (#283 후속 리뷰 §4)", () => {
    const draft = draftWith({
      sourceKind: "url",
      url: { endpoint: "https://user:password@api.example.org/data", format: null },
    });
    const result = buildSpecFromDraft(draft);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/사용자 정보/);
  });

  it("public_api: redact된 secret sentinel이 남은 sourceParams는 fail-closed로 재입력을 요구한다 (#283 후속 리뷰 §1)", () => {
    const draft = draftWith({
      sourceKind: "public_api",
      publicApi: {
        provider: "datago",
        dataset: "apt_trade",
        sourceParams: JSON.stringify({ serviceKey: PARAMS_REDACTED_SENTINEL, page: 1 }),
      },
    });
    const result = buildSpecFromDraft(draft);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/다시 입력/);
  });

  it("출력 형식이 비어 있으면 오류를 반환한다", () => {
    const draft = draftWith({
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{}" },
      exportFormats: [],
    });
    expect(buildSpecFromDraft(draft).error).toMatch(/출력 형식/);
  });
});

describe("draftSignature", () => {
  it("동일 draft는 동일 signature를 만든다", () => {
    const draft = draftWith({
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{}" },
    });
    expect(draftSignature(draft)).toBe(draftSignature({ ...draft }));
  });

  it("source config가 바뀌면 signature도 바뀐다(stale preview 감지, #250)", () => {
    const base = draftWith({
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{}" },
    });
    const changed = { ...base, publicApi: { ...base.publicApi, dataset: "other_dataset" } };
    expect(draftSignature(base)).not.toBe(draftSignature(changed));
  });

  it("preview limit/sample_mode가 바뀌면 signature도 바뀐다", () => {
    const base = draftWith({
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{}" },
    });
    expect(draftSignature(base)).not.toBe(draftSignature({ ...base, previewLimit: 20 }));
    expect(draftSignature(base)).not.toBe(draftSignature({ ...base, previewSampleMode: "random" }));
  });

  it("컬럼 뷰(key/all) 토글은 signature에 영향을 주지 않는다(새 Preview 호출 불필요)", () => {
    const base = draftWith({
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{}" },
    });
    expect(draftSignature(base)).toBe(draftSignature({ ...base, previewColumns: "all" }));
  });
});

describe("applyBuildSpecToDraft", () => {
  it("public_api spec을 draft.publicApi로 되반영한다", () => {
    const result = buildSpecFromDraft(
      draftWith({
        sourceKind: "public_api",
        publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: '{"region":"seoul"}' },
      }),
    );
    const applied = applyBuildSpecToDraft(INITIAL_DRAFT, result.spec!);
    expect(applied.sourceKind).toBe("public_api");
    expect(applied.publicApi.provider).toBe("datago");
    expect(applied.publicApi.dataset).toBe("apt_trade");
    expect(applied.datasetId).toBe(result.spec!.datasetId);
  });

  it("file spec을 draft.file로 되반영한다", () => {
    const result = buildSpecFromDraft(
      draftWith({
        sourceKind: "file",
        file: { uploadId: "upl_0123456789abcdef0123456789abcdef", format: "csv", encoding: "utf-8", filename: null, sizeBytes: null },
      }),
    );
    const applied = applyBuildSpecToDraft(INITIAL_DRAFT, result.spec!);
    expect(applied.sourceKind).toBe("file");
    expect(applied.file.uploadId).toBe("upl_0123456789abcdef0123456789abcdef");
    expect(applied.file.format).toBe("csv");
  });
});

describe("canonical Add Data preservation", () => {
  it("preserves trailing sources, source metadata, extras, and nested metadata after YAML apply", () => {
    const draft = {
      ...INITIAL_DRAFT,
      sourceKind: "public_api" as const,
      datasetId: "dataset",
      title: "Title",
      description: "Description",
      publicApi: { provider: "p", dataset: "d", sourceParams: '{"page":1,"options":{"flag":true}}' },
      exportFormats: ["jsonl"],
    };
    const canonical = {
      ...buildSpecFromDraft(draft).spec!,
      sources: [
        { ...buildSpecFromDraft(draft).spec!.sources[0], alias: "primary", schema: { required: ["id"], dtypes: {}, casts: {} } },
        { kind: "url" as const, endpoint: "https://example.test/secondary.json", method: "GET" as const, params: {} },
      ],
      metadata: { custom: { nested: [1, true] } },
      extra: { publish: { license: "CC-BY" }, quality: { minRows: 1 } },
      exports: [{ format: "jsonl", options: { outputPath: "out/data.jsonl", compression: "gzip" } }],
    };
    const applied = applyBuildSpecToDraft(INITIAL_DRAFT, canonical);
    const rebuilt = buildSpecFromDraft(applied).spec!;
    expect(rebuilt).toEqual(canonical);
  });

  it("redacts nested secrets in every source without mutating the submission spec", () => {
    const original: BuildSpec = {
      ...buildSpecFromDraft({
        ...INITIAL_DRAFT,
        sourceKind: "public_api" as const,
        datasetId: "d",
        title: "t",
        description: "desc",
        publicApi: { provider: "p", dataset: "d", sourceParams: '{"serviceKey":"short-secret","safe":{"region":"seoul"}}' },
      }).spec!,
      sources: [
        { provider: "p", dataset: "d", params: { safe: { region: "seoul" }, serviceKey: "short-secret" } },
        { kind: "public_api" as const, provider: "p2", dataset: "d2", params: { items: [{ token: "short-secret" }] } },
      ],
    };
    const display = redactBuildSpecForDisplay(original);
    expect(JSON.stringify(display)).not.toContain("short-secret");
    expect(original.sources[0].params.serviceKey).toBe("short-secret");
    expect(display.sources[1].params.items).toEqual([{ token: "__KPD_PARAMS_SECRET_REDACTED__" }]);
  });
});

describe("redactBuildSpecForDisplay (#283 리뷰 대응, Epic #246)", () => {
  it("url source의 secret query parameter를 표시용 사본에서만 가린다", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const result = buildSpecFromDraft(
      draftWith({ sourceKind: "url", url: { endpoint: `https://api.example.org/data?api_key=${secret}`, format: null } }),
    );
    const original = result.spec!;
    const displaySpec = redactBuildSpecForDisplay(original);

    expect((displaySpec.sources[0].endpoint ?? "")).not.toContain(secret);
    // The original spec object is not mutated (it keeps being used for the real submission elsewhere).
    expect(original.sources[0].endpoint).toContain(secret);
  });

  it("secret이 없는 url source는 그대로 돌려준다", () => {
    const result = buildSpecFromDraft(
      draftWith({ sourceKind: "url", url: { endpoint: "https://api.example.org/data?region=seoul", format: null } }),
    );
    const displaySpec = redactBuildSpecForDisplay(result.spec!);
    expect(displaySpec.sources[0].endpoint).toBe("https://api.example.org/data?region=seoul");
  });

  it("public_api/file source는 손대지 않는다", () => {
    const result = buildSpecFromDraft(
      draftWith({ sourceKind: "public_api", publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{}" } }),
    );
    const displaySpec = redactBuildSpecForDisplay(result.spec!);
    expect(displaySpec).toEqual(result.spec);
  });

  it("public_api source의 serviceKey는 표시용 사본에서만 가리고 원본은 유지한다 (#283 후속 리뷰 §1)", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const result = buildSpecFromDraft(
      draftWith({
        sourceKind: "public_api",
        publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: JSON.stringify({ page: 1, serviceKey: secret }) },
      }),
    );
    const original = result.spec!;
    const displaySpec = redactBuildSpecForDisplay(original);

    expect(JSON.stringify(displaySpec.sources[0].params)).not.toContain(secret);
    // Non-sensitive values keep Builder's canonical JSON types as-is.
    expect(displaySpec.sources[0].params.page).toBe(1);
    // 원본 spec 객체는 변형되지 않는다(다른 곳에서 실제 제출에 계속 쓰인다).
    expect(original.sources[0].params.serviceKey).toBe(secret);
  });

  it("public_api source의 api_key도 가리되 비민감 param(region)은 유지한다", () => {
    const secret = "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e";
    const result = buildSpecFromDraft(
      draftWith({
        sourceKind: "public_api",
        publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: JSON.stringify({ api_key: secret, region: "seoul" }) },
      }),
    );
    const displaySpec = redactBuildSpecForDisplay(result.spec!);
    expect(JSON.stringify(displaySpec.sources[0].params)).not.toContain(secret);
    expect(displaySpec.sources[0].params.region).toBe("seoul");
  });

  it("public_api source의 고엔트로피 값도 key 이름과 무관하게 가린다", () => {
    const highEntropy = "Zx8pQ2vR7mK4nL9wT1yB6cU3sD0fH5jA8gE2rN7iM4x";
    const result = buildSpecFromDraft(
      draftWith({
        sourceKind: "public_api",
        publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: JSON.stringify({ auth: highEntropy }) },
      }),
    );
    const displaySpec = redactBuildSpecForDisplay(result.spec!);
    expect(JSON.stringify(displaySpec.sources[0].params)).not.toContain(highEntropy);
  });
});

describe("buildSpecFromDraft — restored sentinel 재입력 복구 (#283 후속 리뷰 §2)", () => {
  it("primary source의 sentinel은 canonicalBase가 남아있어도 사용자가 값을 다시 입력하면 제출 가능해진다", () => {
    const restoredBase: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [{ provider: "datago", dataset: "apt_trade", params: { serviceKey: PARAMS_REDACTED_SENTINEL, page: 1 } }],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const restoredDraft = draftWith({
      canonicalBase: restoredBase,
      sourceKind: "public_api",
      publicApi: {
        provider: "datago",
        dataset: "apt_trade",
        sourceParams: JSON.stringify({ serviceKey: PARAMS_REDACTED_SENTINEL, page: 1 }),
      },
    });
    // Right after restore, the sentinel is still in the GUI fields too — still fail-closed.
    expect(buildSpecFromDraft(restoredDraft).error).toMatch(/다시 입력/);

    const reenteredDraft: AddDataDraft = {
      ...restoredDraft,
      publicApi: { ...restoredDraft.publicApi, sourceParams: JSON.stringify({ serviceKey: "real-secret-value", page: 1 }) },
    };
    const result = buildSpecFromDraft(reenteredDraft);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).toMatchObject({ params: { serviceKey: "real-secret-value", page: 1 } });
  });

  it("trailing source(sources[1+])의 sentinel은 primary를 고쳐도 계속 fail-closed이며, YAML로 실값 재입력해야 복구된다", () => {
    const base: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [
        { provider: "datago", dataset: "apt_trade", params: { page: 1 } },
        {
          kind: "url" as const,
          endpoint: `https://example.test/secondary.json?token=${REDACTED_PLACEHOLDER}`,
          method: "GET" as const,
          params: {},
        },
      ],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const draft = draftWith({
      canonicalBase: base,
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: JSON.stringify({ page: 1 }) },
    });
    // The primary source itself has no sentinel, but it remains in the trailing source and keeps blocking.
    expect(buildSpecFromDraft(draft).error).toMatch(/다시 입력/);

    // Replacing the trailing source's sentinel with the real value via YAML Apply recovers it.
    const fixedSpec: BuildSpec = {
      ...base,
      sources: [base.sources[0], { ...base.sources[1], endpoint: "https://example.test/secondary.json?token=real-value" }],
    };
    const appliedDraft = applyBuildSpecToDraft(draft, fixedSpec);
    expect(buildSpecFromDraft(appliedDraft).error).toBeUndefined();
  });
});

describe("buildEditableSpecFromDraft — YAML 에디터 fail-closed 우회 표시 (#283 후속 리뷰 §3)", () => {
  it("sentinel 때문에 buildSpecFromDraft가 실패해도 candidate spec은 계속 반환한다", () => {
    const base: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [{ provider: "datago", dataset: "apt_trade", params: { serviceKey: PARAMS_REDACTED_SENTINEL } }],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const draft = draftWith({
      canonicalBase: base,
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: JSON.stringify({ serviceKey: PARAMS_REDACTED_SENTINEL }) },
    });

    expect(buildSpecFromDraft(draft).spec).toBeUndefined();
    const editable = buildEditableSpecFromDraft(draft);
    expect(editable).toBeDefined();
    expect(JSON.stringify(editable)).toContain(PARAMS_REDACTED_SENTINEL);
  });
});

describe("buildSpecFromDraft — URL query-only 변경은 identity를 유지한다 (#283 후속 리뷰 §5)", () => {
  it("query만 바뀌면 alias/schema 등 canonicalBase 보존 필드를 잃지 않는다", () => {
    const base: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [
        {
          kind: "url" as const,
          endpoint: "https://api.example.org/data?region=seoul",
          method: "GET" as const,
          alias: "raw",
          schema: { required: ["id"], dtypes: {}, casts: {} },
          params: {},
        },
      ],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const draft = draftWith({
      canonicalBase: base,
      sourceKind: "url",
      url: { endpoint: "https://api.example.org/data?region=busan", format: null },
    });
    const result = buildSpecFromDraft(draft);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).toMatchObject({
      endpoint: "https://api.example.org/data?region=busan",
      alias: "raw",
      schema: { required: ["id"], dtypes: {}, casts: {} },
    });
  });

  it("hostname/path가 바뀌면 다른 source로 취급해 이전 alias/schema를 유지하지 않는다", () => {
    const base: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [
        {
          kind: "url" as const,
          endpoint: "https://api.example.org/data?region=seoul",
          method: "GET" as const,
          alias: "raw",
          schema: { required: ["id"], dtypes: {}, casts: {} },
          params: {},
        },
      ],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const draft = draftWith({
      canonicalBase: base,
      sourceKind: "url",
      url: { endpoint: "https://other.example.org/other-path", format: null },
    });
    const result = buildSpecFromDraft(draft);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).not.toHaveProperty("alias");
    expect(result.spec?.sources[0]).not.toHaveProperty("schema");
  });
});

describe("buildSpecFromDraft — duplicate export round-trip (#283 후속 리뷰 §7)", () => {
  it("같은 format의 export가 2개 있으면 각각 options/outputPath를 독립적으로 보존한다", () => {
    const base: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [{ provider: "datago", dataset: "apt_trade", params: {} }],
      exports: [
        { format: "jsonl", options: { outputPath: "a/data.jsonl", compression: "gzip" } },
        { format: "jsonl", options: { outputPath: "b/data.jsonl", compression: "none" } },
      ],
      metadata: {},
    };
    const draft = draftWith({
      canonicalBase: base,
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{}" },
      exportFormats: ["jsonl", "jsonl"],
    });
    const result = buildSpecFromDraft(draft);
    expect(result.error).toBeUndefined();
    expect(result.spec?.exports).toEqual(base.exports);
  });
});
