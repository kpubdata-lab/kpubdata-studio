/**
 * Builder API calls through the shared MSW handlers (#160, #104).
 *
 * This used to start a second MSW server over its own handler set, which answered with an
 * `api_version` years behind the contract (#993). It now runs against the one shared set
 * (`__tests__/msw/handlers.ts`) that every other test uses.
 */
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { MOCK_BUILDER_API_VERSION } from "./msw/handlers";
import { server } from "./msw/setup";
import { API_BASE } from "@/shared/config/env";
import { builderApi } from "@/shared/lib/builderApi";

const spec = (datasetId: string) =>
  `dataset_id: ${datasetId}\ntitle: Test\ndescription: test\nsources:\n  - key: sample\n    provider: sample\n    dataset: sample\n    params:\n      region: seoul\n`;

describe("Builder API E2E (MSW)", () => {
  it("GET /version returns service info", async () => {
    const result = await builderApi.version();
    expect(result.service).toBe("kpubdata-builder");
    expect(result.api_version).toBe(MOCK_BUILDER_API_VERSION);
  });

  it("POST /validate accepts a spec and returns valid", async () => {
    const result = await builderApi.validate(spec("dataset.sample"));
    expect(result.status).toBe("valid");
  });

  it("POST /preview returns preview data", async () => {
    const result = await builderApi.preview(spec("dataset.sample"));
    expect(result.previews).toHaveLength(1);
    expect(result.previews[0].status).toBe("ok");
  });

  it("POST /build returns build result with outcomes", async () => {
    const result = await builderApi.build(spec("success"));
    expect(result.status).toBe("ok");
    expect(result.run_id).toBe("run_123");
    expect(result.outcomes).toHaveLength(1);
  });

  it("GET /builds returns build list", async () => {
    server.use(
      http.get(`${API_BASE}/builds`, () =>
        HttpResponse.json({
          builds: [
            { run_id: "run_123", status: "ok", started_at: "2025-01-01T00:00:00Z", finished_at: "2025-01-01T00:05:00Z" },
          ],
        }),
      ),
    );
    const result = await builderApi.listBuilds();
    expect(result.builds).toHaveLength(1);
    expect(result.builds[0].run_id).toBe("run_123");
  });

  it("GET /artifacts/:runId returns file list", async () => {
    const result = await builderApi.artifacts("run_123");
    expect(result.run_id).toBe("run_123");
    expect(result.files).toContain("manifest.json");
  });
});
