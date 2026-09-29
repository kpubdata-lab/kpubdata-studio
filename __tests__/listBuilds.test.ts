/**
 * listBuilds 실연동 모드 분기 테스트 (#95, #153).
 *
 * mock 모드에서는 결정적 mock 이력을 반환하고, 실연동 모드에서는 Builder GET /builds를
 * 호출하여 BuildListItem[]으로 매핑하는지 검증한다(#153, builder #250).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { listBuilds } from "@/features/runs/api";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("listBuilds (#95, #153)", () => {
  describe("mock mode", () => {
    it("returns deterministic mock history with BuildListItem structure", async () => {
      const builds = await listBuilds();
      expect(builds.length).toBe(6);
      // mock 데이터는 실제 title을 가짐
      expect(builds.map((b) => b.title)).toContain("대기오염 정보");
      // 모든 항목이 필수 필드를 가짐
      builds.forEach((item) => {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("status");
        expect(item).toHaveProperty("startedAt");
        expect(item).toHaveProperty("finishedAt");
      });
    });

    it("does not make network calls in mock mode", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await listBuilds();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("real integration mode", () => {
    it("calls Builder GET /builds without limit parameter", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, { builds: [] }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await listBuilds();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/builds");
      expect(String(url)).not.toContain("?limit=");
    });

    it("calls Builder GET /builds?limit=N with limit parameter", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, { builds: [] }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await listBuilds(25);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/builds?limit=25");
    });

    it("maps Builder response to BuildListItem[] correctly", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
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

      const result = await listBuilds();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: "run_123",
        title: null, // Builder provides no title
        status: "succeeded", // "ok" -> "succeeded"
        startedAt: "2024-01-15T10:30:00Z",
        finishedAt: "2024-01-15T11:45:00Z",
      });
      expect(result[1]).toMatchObject({
        id: "run_456",
        title: null, // Builder provides no title
        status: "failed", // "failed" -> "failed"
        startedAt: "2024-01-16T14:20:00Z",
        finishedAt: null, // null preserved
      });
    });

    it("correctly maps Builder status to BuildRunStatus", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, {
          builds: [
            { run_id: "ok_build", status: "ok", started_at: "2024-01-15T10:00:00Z", finished_at: null },
            { run_id: "failed_build", status: "failed", started_at: "2024-01-15T11:00:00Z", finished_at: null },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await listBuilds();

      expect(result[0].status).toBe("succeeded");
      expect(result[1].status).toBe("failed");
    });

    it("preserves null timestamps from Builder response", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, {
          builds: [
            {
              run_id: "run_null_times",
              status: "ok",
              started_at: null,
              finished_at: null,
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await listBuilds();

      expect(result[0].startedAt).toBeNull();
      expect(result[0].finishedAt).toBeNull();
    });

    it("handles omitted timestamps in Builder response", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, {
          builds: [
            {
              run_id: "run_without_times",
              status: "ok",
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await listBuilds();

      expect(result[0].startedAt).toBeNull();
      expect(result[0].finishedAt).toBeNull();
    });

    it("returns empty array when Builder returns empty builds array", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, { builds: [] }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await listBuilds();

      expect(result).toEqual([]);
    });

    it("propagates HTTP errors without converting to empty array", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(500, { error: "Internal server error" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(listBuilds()).rejects.toThrow();
    });

    it("propagates network errors without converting to empty array", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockRejectedValue(
        new Error("Network connection failed"),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(listBuilds()).rejects.toThrow("Builder API에 연결하지 못했습니다.");
    });

    it("maintains backward compatibility with no-argument calls", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, { builds: [] }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await listBuilds(); // No argument

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/builds");
      expect(String(url)).not.toContain("?limit=");
    });
  });
});
