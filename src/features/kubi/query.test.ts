import { afterEach, describe, expect, it, vi } from "vitest";
import { blockedReason, runKubiQuery } from "./query";
import type { KubiContext, KubiGeneratedSql } from "./types";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

const SILVER_CONTEXT: KubiContext = { page: "dataset-detail", datasetId: "ds-1", runId: "run-1", stage: "silver" };
const SILVER_SQL: KubiGeneratedSql = { sql: "SELECT * FROM dataset", stage: "silver" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("blockedReason (#256)", () => {
  it("blocks execution in a Bronze context", () => {
    expect(blockedReason({ ...SILVER_CONTEXT, stage: "bronze" }, SILVER_SQL)).toMatch(/Bronze/);
  });

  it("blocks execution when the SQL stage doesn't match the current context stage", () => {
    expect(blockedReason(SILVER_CONTEXT, { ...SILVER_SQL, stage: "gold" })).toMatch(/stage/);
  });

  it("blocks execution when dataset/run aren't both selected", () => {
    expect(blockedReason({ page: "quality", stage: "silver" }, SILVER_SQL)).toMatch(/dataset.*run|run.*dataset/i);
  });

  it("allows execution for a matching Silver/Gold context", () => {
    expect(blockedReason(SILVER_CONTEXT, SILVER_SQL)).toBeNull();
  });
});

describe("runKubiQuery (#256, Builder #504 contract 1.7.0)", () => {
  it("never calls fetch when Bronze is blocked", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runKubiQuery({ ...SILVER_CONTEXT, stage: "bronze" }, SILVER_SQL);
    expect(result.status).toBe("blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a mock_mode error without calling fetch when VITE_USE_REAL_BUILDER is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runKubiQuery(SILVER_CONTEXT, SILVER_SQL);
    expect(result).toEqual({ status: "error", code: "mock_mode", message: expect.stringContaining("mock 모드") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Builder POST /query with dataset_id/run_id/stage/sql and returns columns/rows/truncated/execution_ms", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { columns: ["id"], rows: [{ id: 1 }], truncated: false, execution_ms: 12 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runKubiQuery(SILVER_CONTEXT, SILVER_SQL);

    expect(result).toEqual({
      status: "success",
      result: { columns: ["id"], rows: [{ id: 1 }], truncated: false, execution_ms: 12 },
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toEqual({ dataset_id: "ds-1", run_id: "run-1", stage: "silver", sql: SILVER_SQL.sql });
  });

  it("surfaces truncated=true so the UI must show a partial-results notice", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse(200, { columns: ["id"], rows: [{ id: 1 }], truncated: true, execution_ms: 5 })),
    );
    const result = await runKubiQuery(SILVER_CONTEXT, SILVER_SQL);
    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.result.truncated).toBe(true);
  });

  it("classifies a 400 unsafe_query error with its code", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(400, { error: "invalid SQL syntax", code: "unsafe_query" })));
    const result = await runKubiQuery(SILVER_CONTEXT, SILVER_SQL);
    expect(result).toMatchObject({ status: "error", code: "unsafe_query" });
  });

  it("classifies a 429 query_busy (saturation) error", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429, { error: "query is busy", code: "query_busy" })));
    const result = await runKubiQuery(SILVER_CONTEXT, SILVER_SQL);
    expect(result).toMatchObject({ status: "error", code: "query_busy" });
  });

  it("classifies a 504 query_timeout error", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(504, { error: "query timed out", code: "query_timeout" })));
    const result = await runKubiQuery(SILVER_CONTEXT, SILVER_SQL);
    expect(result).toMatchObject({ status: "error", code: "query_timeout" });
  });

  it("classifies a 403 forbidden (ownership) error", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(403, { error: "forbidden", code: "forbidden" })));
    const result = await runKubiQuery(SILVER_CONTEXT, SILVER_SQL);
    expect(result).toMatchObject({ status: "error", code: "forbidden" });
  });

  it("classifies a network failure distinctly", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const result = await runKubiQuery(SILVER_CONTEXT, SILVER_SQL, undefined);
    expect(result.status).toBe("error");
  });
});
