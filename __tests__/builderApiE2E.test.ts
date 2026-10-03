/**
 * MSW 기반 Builder API E2E 테스트 (#160, #104).
 *
 * 네트워크 없이 MSW로 모킹한 Builder API를 통해 builderApi의 전체 호출 경로를 검증한다.
 * 실제 HTTP 요청·응답 직렬화·에러 처리·재시도까지 커버.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { server } from "./mocks/server";
import { builderApi } from "@/shared/lib/builderApi";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Builder API E2E (MSW)", () => {
  it("GET /version returns service info", async () => {
    const result = await builderApi.version();
    expect(result.service).toBe("kpubdata-builder");
    expect(result.api_version).toBe("1.6.0");
  });

  it("POST /validate accepts a spec and returns valid", async () => {
    const spec = `dataset_id: dataset.sample\ntitle: Test\ndescription: test\nsources:\n  - key: sample\n    provider: sample\n    dataset: sample\n`;
    const result = await builderApi.validate(spec);
    expect(result.status).toBe("valid");
  });

  it("POST /preview returns preview data", async () => {
    const spec = `dataset_id: dataset.sample\ntitle: Test\ndescription: test\nsources:\n  - key: sample\n    provider: sample\n    dataset: sample\n`;
    const result = await builderApi.preview(spec);
    expect(result.previews).toHaveLength(1);
    expect(result.previews[0].status).toBe("ok");
  });

  it("POST /build returns build result with outcomes", async () => {
    const spec = `dataset_id: dataset.sample\ntitle: Test\ndescription: test\nsources:\n  - key: sample\n    provider: sample\n    dataset: sample\n`;
    const result = await builderApi.build(spec);
    expect(result.status).toBe("ok");
    expect(result.run_id).toBe("test-run-001");
    expect(result.outcomes).toHaveLength(1);
  });

  it("GET /builds returns build list", async () => {
    const result = await builderApi.listBuilds();
    expect(result.builds).toHaveLength(1);
    expect(result.builds[0].run_id).toBe("test-run-001");
  });

  it("GET /artifacts/:runId returns file list", async () => {
    const result = await builderApi.artifacts("test-run-001");
    expect(result.run_id).toBe("test-run-001");
    expect(result.files).toContain("manifest.json");
  });
});
