/**
 * The shared MSW handlers stay one set, and answer as a Builder Studio accepts (#993).
 *
 * Studio once carried two handler sets, each started by its own MSW server, answering
 * with `api_version` 1.0.0 and 1.6.0 while Studio needed 1.96.0. Tests passed against
 * responses no supported Builder sends. This checks:
 *
 * - one MSW server: `setupServer` is called only in `vitest.setup.ts`;
 * - no two shared handlers answer the same method and path;
 * - every `api_version` a shared handler answers with is compatible with Studio's floor,
 *   and a mock that claims an older Builder is refused by the same check.
 */
import { execFileSync } from "node:child_process";
import { http, HttpResponse, type RequestHandler } from "msw";
import { describe, expect, it } from "vitest";

import { handlers, MOCK_BUILDER_API_VERSION } from "./msw/handlers";
import { server } from "./msw/setup";
import { API_BASE } from "@/shared/config/env";
import { builderApi, builderApiCompatibility, isBuilderApiCompatible } from "@/shared/lib/builderApi";

/** `METHOD path` of each handler registered more than once; path parameter names are ignored. */
function duplicateRoutes(list: readonly RequestHandler[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const handler of list) {
    const route = handler.info.header.replace(/:[A-Za-z_]\w*/g, ":param");
    if (seen.has(route)) duplicates.push(route);
    seen.add(route);
  }
  return duplicates;
}

const spec = (datasetId: string) =>
  `dataset_id: ${datasetId}\nsources:\n  - provider: kma\n    dataset: forecast\n    params:\n      region: seoul\n`;

/** POST a spec and return the `api_version` of the body, whatever the status. */
async function answeredVersion(path: string, datasetId: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec: spec(datasetId) }),
  });
  return ((await response.json()) as { api_version?: unknown }).api_version;
}

describe("shared MSW handlers (#993)", () => {
  it("are started by one MSW server only", () => {
    const callers = execFileSync("git", ["grep", "-l", "setupServer(", "--", "*.ts", "*.tsx"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(callers).toEqual(["vitest.setup.ts"]);
  });

  it("register each method and path once", () => {
    expect(duplicateRoutes(handlers)).toEqual([]);
  });

  it("reports a second handler for a route already registered, whatever its parameter is called", () => {
    const again = [
      ...handlers,
      http.get(`${API_BASE}/version`, () => HttpResponse.json({})),
      http.get(`${API_BASE}/artifacts/:runId`, () => HttpResponse.json({})),
    ];
    expect(duplicateRoutes(again)).toEqual([`GET ${API_BASE}/version`, `GET ${API_BASE}/artifacts/:param`]);
  });

  it("answer with an api_version Studio accepts", async () => {
    expect(isBuilderApiCompatible(MOCK_BUILDER_API_VERSION)).toBe(true);

    const versions = [
      (await builderApi.version()).api_version,
      await answeredVersion("/validate", "weather_report"),
      await answeredVersion("/build", "success"),
      await answeredVersion("/build", "fail_source"),
      await answeredVersion("/build", "default"),
    ];

    const { run_id } = await builderApi.submitBuild(spec("default"), "run_993");
    let job = await builderApi.getBuildJob(run_id);
    for (let poll = 0; poll < 5 && job.status !== "succeeded"; poll++) job = await builderApi.getBuildJob(run_id);
    expect(job.status).toBe("succeeded");
    versions.push(job.response?.api_version);

    expect(versions).toEqual(versions.map(() => MOCK_BUILDER_API_VERSION));
  });

  it("refuse a mock that claims an older Builder", async () => {
    server.use(
      http.get(`${API_BASE}/version`, () => HttpResponse.json({ service: "kpubdata-builder", api_version: "1.6.0" })),
    );
    const { api_version } = await builderApi.version();
    expect(builderApiCompatibility(api_version)).toEqual({ kind: "too_old" });
  });
});
