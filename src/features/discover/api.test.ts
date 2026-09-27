/**
 * loadCatalog (#249) mock/real branch tests.
 *
 * Verifies mock mode returns the deterministic fixture without touching the
 * network, and real mode calls Builder GET /catalog (#246 mock/real
 * separation principle).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalog } from "./api";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadCatalog (#249)", () => {
  describe("mock mode", () => {
    it("does not make a network call", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await loadCatalog();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns a deterministic catalog with multiple providers and a mix of requires_service_key", async () => {
      const catalog = await loadCatalog();
      expect(catalog.providers.length).toBeGreaterThan(1);

      const allDatasets = catalog.providers.flatMap((provider) => provider.datasets);
      expect(allDatasets.some((dataset) => dataset.requires_service_key)).toBe(true);
      expect(allDatasets.some((dataset) => !dataset.requires_service_key)).toBe(true);
    });
  });

  describe("real integration mode", () => {
    it("calls Builder GET /catalog and returns the parsed response", async () => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, {
          providers: [
            {
              name: "datago",
              datasets: [
                {
                  name: "air",
                  title: "대기질",
                  description: "전국 측정소별 대기질 측정정보",
                  tags: ["대기질", "환경"],
                  source_url: "https://api.data.go.kr/openapi",
                  representation: "api_json",
                  operations: ["list", "get"],
                  query_support: null,
                  requires_service_key: true,
                },
              ],
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const catalog = await loadCatalog();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/catalog");
      expect(catalog.providers[0].name).toBe("datago");
    });
  });
});
