/**
 * The direct run lookup needs Builder API 1.31.0 (#482). An older Builder answers the
 * path with a 404 that means "no such route", so it must not be read as "no such run".
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { mswServer } from "../vitest.setup";
import { useRequestedRun } from "@/features/datasets/useRequestedRun";
import { resetVersionCheck } from "@/features/version-check/store";
import { API_BASE } from "@/shared/config/env";
import type { DatasetRunSummary } from "@/shared/lib/builderApi";

const PAGE: DatasetRunSummary[] = [
  { run_id: "r-new", status: "ok", started_at: null, finished_at: null, spec_digest: null, created_by: null },
];
const OLD = { run_id: "r-old", status: "ok", started_at: null, finished_at: null, spec_digest: null, created_by: null };

let lookups = 0;

function engine(version: { status: number; api?: string }) {
  lookups = 0;
  mswServer.use(
    http.get(`${API_BASE}/version`, () =>
      version.status === 200
        ? HttpResponse.json({ service: "kpubdata-builder", api_version: version.api })
        : new HttpResponse(null, { status: version.status }),
    ),
    http.get(`${API_BASE}/datasets/t1/runs/r-old`, () => {
      lookups += 1;
      return HttpResponse.json({ dataset_id: "t1", run: OLD });
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  resetVersionCheck();
});
afterEach(() => vi.unstubAllEnvs());

describe("requested run vs Builder API version (#482)", () => {
  it("says unsupported, without asking, when the Builder is older than 1.31.0", async () => {
    engine({ status: 200, api: "1.30.0" });
    const { result } = renderHook(() => useRequestedRun("t1", "r-old", PAGE));
    await waitFor(() => expect(result.current.status).toBe("unsupported"));
    expect(lookups).toBe(0);
  });

  it("looks the run up on 1.31.0", async () => {
    engine({ status: 200, api: "1.31.0" });
    const { result } = renderHook(() => useRequestedRun("t1", "r-old", PAGE));
    await waitFor(() => expect(result.current).toMatchObject({ status: "available", inPage: false }));
    expect(lookups).toBe(1);
  });

  it("still looks it up when the version is unknown", async () => {
    engine({ status: 500 });
    const { result } = renderHook(() => useRequestedRun("t1", "r-old", PAGE));
    await waitFor(() => expect(result.current.status).toBe("available"), { timeout: 8000 });
    expect(lookups).toBe(1);
  });
});
