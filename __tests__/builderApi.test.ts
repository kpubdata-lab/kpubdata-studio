import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiFetch,
  builderApi,
  extractErrorMessage,
  formatApiErrorMessage,
} from "@/shared/lib/builderApi";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("builderApi client (#29)", () => {
  it("version() GETs /version and returns the parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.version();

    expect(result.api_version).toBe("1.0.0");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/version");
    expect(init.method).toBe("GET");
  });

  it("preview() POSTs spec to /preview (#75)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        dataset_id: "test_dataset",
        previews: [],
        api_version: "1.0.0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await builderApi.preview("dataset_id: x");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/preview");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ spec: "dataset_id: x" });
  });

  it("build() POSTs spec + run_id as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        status: "ok",
        run_id: "run1",
        outcomes: [],
        manifest: "m.json",
        api_version: "1.0.0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.build("dataset_id: x", "run1");

    expect(result.run_id).toBe("run1");
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ spec: "dataset_id: x", run_id: "run1" });
  });

  it("throws ApiError with the server message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(400, { error: "bad spec" })));

    await expect(apiFetch("/validate", { method: "POST", body: { spec: "" } })).rejects.toMatchObject(
      { name: "ApiError", status: 400, message: "bad spec" },
    );
  });

  it("throws ApiError(0) when the network call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const error = await apiFetch("/version").catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  it("listBuilds() calls GET /builds without limit parameter (#153)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { builds: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await builderApi.listBuilds();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/builds");
    expect(String(url)).not.toContain("?limit=");
    expect(init.method).toBe("GET");
  });

  it("listBuilds() calls GET /builds?limit=N with limit parameter (#153)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { builds: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await builderApi.listBuilds(25);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/builds?limit=25");
    expect(init.method).toBe("GET");
  });

  it("listBuilds() parses Builder wire response correctly (#153)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        builds: [
          {
            run_id: "run_123",
            status: "ok",
            started_at: "2024-01-15T10:30:00Z",
            finished_at: "2024-01-15T11:45:00Z",
          },
          {
            run_id: "run_456",
            status: "failed",
            started_at: "2024-01-16T14:20:00Z",
            finished_at: null,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.listBuilds();

    expect(result.builds).toHaveLength(2);
    expect(result.builds[0]).toMatchObject({
      run_id: "run_123",
      status: "ok",
      started_at: "2024-01-15T10:30:00Z",
      finished_at: "2024-01-15T11:45:00Z",
    });
    expect(result.builds[1]).toMatchObject({
      run_id: "run_456",
      status: "failed",
      started_at: "2024-01-16T14:20:00Z",
      finished_at: null,
    });
  });

  it("catalog() parses Builder provider/dataset catalog responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        providers: [
          {
            name: "datago",
            datasets: [
              {
                name: "air_quality",
                title: "대기오염",
                description: null,
                tags: [],
                source_url: null,
                representation: "api_json",
                operations: [],
                query_support: null,
                requires_service_key: true,
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.catalog();

    expect(result.providers[0]?.name).toBe("datago");
    expect(result.providers[0]?.datasets[0]).toMatchObject({
      name: "air_quality",
      title: "대기오염",
      requires_service_key: true,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/catalog");
    expect(init.method).toBe("GET");
  });

  it("getProviderCredential() parses the exact Builder GET wire body (no provider field)", async () => {
    // Builder SSOT: GET /providers/{provider}/credential returns
    // ProviderCredentialGetResponse = { configured, masked, updated_at } only.
    // `provider` is never on the GET response; the schema must accept this body
    // verbatim (it rejected it while `provider` was wrongly required).
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { configured: false, masked: null, updated_at: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.getProviderCredential("datago");

    expect(result).toEqual({ configured: false, masked: null, updated_at: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/providers/datago/credential");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("getPublishReadiness() sends only target=huggingface and parses the exact Run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {
      run_id: "run-270",
      target: "huggingface",
      ready: true,
      blockers: [],
      warnings: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.getPublishReadiness("run-270", "huggingface");

    expect(result.run_id).toBe("run-270");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/builds/run-270/publish/readiness?target=huggingface");
    expect(String(url)).not.toContain("destination");
    expect(String(url)).not.toContain("private");
    expect(init.method).toBe("GET");
  });

  it("publishBuild() sends the Builder #547 body without credentials or invented fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {
      run_id: "run-270",
      target: "huggingface",
      publisher: "huggingface",
      destination: "owner/dataset",
      reference: "https://huggingface.co/datasets/owner/dataset",
      artifact_count: 1,
      status: "ok",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = { target: "huggingface" as const, destination: "owner/dataset", options: { private: true } };

    const result = await builderApi.publishBuild("run-270", request);

    expect(result.reference).toContain("huggingface.co");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/builds/run-270/publish");
    expect(JSON.parse(init.body)).toEqual(request);
    expect(init.body).not.toContain("token");
    expect(init.body).not.toContain("credential");
    expect(init.body).not.toContain("version");
  });

  it("surfaces outcomes[].error on a 502 with no top-level error (#75)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(502, {
          status: "failed",
          outcomes: [{ source_key: "datago", status: "failed", error: "source 502" }],
        }),
      ),
    );

    const error = await apiFetch("/build", { method: "POST", body: { spec: "" } }).catch(
      (cause) => cause,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("source 502");
  });
});

describe("extractErrorMessage (#75)", () => {
  it("extracts the real reason from outcomes[].error (no top-level error)", () => {
    expect(
      extractErrorMessage({
        status: "failed",
        outcomes: [{ source_key: "datago", status: "failed", error: "인증 실패" }],
      }),
    ).toBe("인증 실패");
  });

  it("joins multiple outcome errors with a semicolon", () => {
    expect(
      extractErrorMessage({ outcomes: [{ error: "A" }, { error: null }, { error: "B" }] }),
    ).toBe("A; B");
  });

  it("prefers a top-level error over outcomes (backward compat)", () => {
    expect(extractErrorMessage({ error: "top", outcomes: [{ error: "ignored" }] })).toBe("top");
  });

  it("returns undefined when no structured reason is present", () => {
    expect(extractErrorMessage({ status: "failed", outcomes: [] })).toBeUndefined();
    expect(extractErrorMessage(undefined)).toBeUndefined();
    expect(extractErrorMessage("oops")).toBeUndefined();
  });
});

describe("formatApiErrorMessage (#159)", () => {
  it("400 - 기본 메시지 반환", () => {
    expect(formatApiErrorMessage(400, undefined)).toBe("요청 형식이 올바르지 않습니다.");
  });

  it("404 - 기본 메시지 반환", () => {
    expect(formatApiErrorMessage(404, undefined)).toBe("요청한 리소스를 찾을 수 없습니다.");
  });

  it("404 - run_id 포함 응답 시 메시지에 run_id 추가", () => {
    const message = formatApiErrorMessage(404, { run_id: "run_123" });
    expect(message).toContain("run_123");
  });

  it("502 - 기본 메시지 반환", () => {
    expect(formatApiErrorMessage(502, undefined)).toBe("데이터 소스에서 오류가 발생했습니다.");
  });

  it("extractErrorMessage가 있으면 해당 메시지 우선", () => {
    const message = formatApiErrorMessage(400, { error: "구체적 에러" });
    expect(message).toContain("구체적 에러");
  });

  it("404 - 리소스 없음 응답 스키마 검증", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, {
        error: "run not found: run_999",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await apiFetch("/artifacts/run_999");
      expect.fail("ApiError가 발생해야 합니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(404);
      expect(apiError.message).toContain("run_999");
    }
  });
});

describe("Zod 스키마 런타임 검증 (#158, #103)", () => {
  it("version() 스키마 검증 - 올바른 응답 통과", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.version();

    expect(result.service).toBe("kpubdata-builder");
    expect(result.api_version).toBe("1.0.0");
  });

  it("version() 스키마 검증 - 필드 누락 시 실패", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { service: "kpubdata-builder" }), // api_version 누락
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(builderApi.version()).rejects.toThrow("Builder API 응답이 예상된 형식과 일치하지 않습니다");
  });

  it("validate() 스키마 검증 - valid 응답 통과", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        status: "valid",
        dataset_id: "test_dataset",
        api_version: "1.0.0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.validate("dataset_id: x");

    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.dataset_id).toBe("test_dataset");
    }
  });

  it("validate() 스키마 검증 - invalid 응답 통과", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(400, {
        status: "invalid",
        problems: ["필수 파라미터 누락"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await builderApi.validate("invalid");
      expect.fail("ApiError가 발생해야 합니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });

  it("build() 스키마 검증 - ok 응답 통과", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        status: "ok",
        run_id: "run_123",
        outcomes: [
          {
            source_key: "kma__forecast",
            status: "ok",
            stages_completed: ["bronze", "silver"],
            error: null,
          },
        ],
        manifest: "output/run_123/manifest.json",
        api_version: "1.0.0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.build("dataset_id: x");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.run_id).toBe("run_123");
      expect(result.outcomes).toHaveLength(1);
    }
  });

  it("preview() 스키마 검증 - 올바른 응답 통과", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        dataset_id: "weather_report",
        previews: [
          {
            source_key: "kma__forecast",
            status: "ok",
            error: null,
            schema: [
              { name: "date", dtype: "Utf8", nullable: false, unique_count: 30 },
            ],
            sample: [{ date: "2024-04-01" }],
            total_rows: 30,
            statistics: { row_count: 30, null_counts: { date: 0 }, duplicate_rate: 0 },
            quality_results: [],
            source_sample: [{ date: "2024-04-01" }],
            sample_mode: "first",
            diff_available: false,
            diffs: [],
            transform_summary: null,
            diff_truncated: false,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.preview("dataset_id: x");

    expect(result.dataset_id).toBe("weather_report");
    expect(result.previews).toHaveLength(1);
    expect(result.previews[0].schema).toBeDefined();
  });

  it("artifacts() 스키마 검증 - 올바른 응답 통과", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        run_id: "run_123",
        files: ["manifest.json", "data.parquet"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderApi.artifacts("run_123");

    expect(result.run_id).toBe("run_123");
    expect(result.files).toContain("manifest.json");
  });
});
