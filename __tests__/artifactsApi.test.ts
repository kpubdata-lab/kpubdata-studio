/**
 * artifacts API 진입점 테스트 (#75).
 *
 * 실연동 모드에서 Builder `/artifacts/{run_id}`의 실제 와이어 형태({files, run_id})를
 * 페이지가 쓰는 BuildManifest로 매핑하는지, mock 모드에서는 기존 mock manifest를 그대로
 * 반환하는지 검증한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBuildManifest } from "@/features/artifacts/api";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getBuildManifest (#75)", () => {
  it("returns the authoritative Builder manifest without synthesizing or dropping fields", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        build_id: "run-99",
        schema_version: "2.3.0",
        started_at: "2026-08-31T00:00:00Z",
        finished_at: "2026-08-31T00:01:00Z",
        status: "cancelled",
        partial: true,
        outputs: ["artifacts/builds/run-99/data.jsonl"],
        inputs_fingerprint: "sha256:authoritative",
        created_by: "oidc:user",
        future_builder_field: { preserved: true },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const manifest = await getBuildManifest("run-99");

    expect(String(fetchMock.mock.calls[0][0])).toContain("/builds/run-99/manifest");
    expect(manifest.build_id).toBe("run-99");
    expect(manifest.schema_version).toBe("2.3.0");
    expect(manifest.inputs_fingerprint).toBe("sha256:authoritative");
    expect(manifest).toMatchObject({ future_builder_field: { preserved: true } });
    expect(manifest.build_environment).toBeUndefined();
  });

  it("does not replace an unavailable real manifest with a synthetic manifest", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(404, { error: "manifest not found" })));

    await expect(getBuildManifest("missing-run")).rejects.toThrow();
  });

  it("returns the mock manifest without network in mock mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const manifest = await getBuildManifest("apt-trade-20260621");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(manifest.build_id).toBe("apt-trade-20260621");
    // 성공한 빌드는 row_counts가 제공됨
    expect(manifest.row_counts).toBeDefined();
    const total = Object.values(manifest.row_counts ?? {}).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("returns mock manifest with undefined fields for failed builds (#119)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // 실패한 빌드에 대한 mock manifest
    const manifest = await getBuildManifest("dur-older-adult-caution-20260618");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(manifest.build_id).toBe("dur-older-adult-caution-20260618");
    // 실패한 빌드는 row_counts가 제공되지 않음 (undefined)
    expect(manifest.row_counts).toBeUndefined();
    expect(manifest.schema_summaries).toBeUndefined();
    expect(manifest.provenance).toBeUndefined();
    // errors는 제공됨
    expect(manifest.errors).toBeDefined();
    expect(manifest.errors?.length).toBeGreaterThan(0);
  });
});
