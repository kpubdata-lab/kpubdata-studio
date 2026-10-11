/**
 * The clients #902 moved behind one interface choose by the deployment, and each side
 * answers as the screen answered before the move.
 *
 * - SQL: Builder's rows, or its refusal classified; the demo's fixed rows, marked `demo`.
 * - Spec validation: the demo passes every spec without a request.
 * - Monitoring: the demo's fixture, with no request; Builder's two reads together.
 * - The version check: the demo resolves without a request and records nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoMonitoringClient, monitoringClient, realMonitoringClient } from "@/features/monitoring/api/client";
import { demoSqlClient, realSqlClient, runTableQuery, sqlClient } from "@/features/sql/api";
import { demoValidationClient, realValidationClient, validationClient } from "@/features/validation/api";
import { ensureVersionChecked, resetVersionCheck, useVersionCheckStore } from "@/features/version-check/store";
import { builderApi } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

const request = { dataset_id: "air", run_id: "run-1", stage: "silver", sql: "SELECT 1" } as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetVersionCheck();
});

describe("choosing the client", () => {
  it.each([
    ["sql", sqlClient, realSqlClient, demoSqlClient],
    ["validation", validationClient, realValidationClient, demoValidationClient],
    ["monitoring", monitoringClient, realMonitoringClient, demoMonitoringClient],
  ] as const)("%s: Builder's with one configured, the demo's otherwise", (_name, select, real, demo) => {
    expect(select()).toBe(demo);
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    expect(select()).toBe(real);
  });
});

describe("SQL", () => {
  it("the demo answers with its fixed rows, marked demo, and asks nothing", async () => {
    const query = vi.spyOn(builderApi, "query");
    const outcome = await runTableQuery(request);
    expect(outcome).toMatchObject({ status: "success", demo: true });
    expect(outcome.status === "success" && outcome.result.columns).toEqual(["station_name", "avg_pm10"]);
    expect(query).not.toHaveBeenCalled();
  });

  it("Builder's rows are not marked demo, and its refusal is classified", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const result = { columns: ["n"], rows: [{ n: 1 }], truncated: false, execution_ms: 3 };
    const query = vi.spyOn(builderApi, "query").mockResolvedValueOnce(result);
    await expect(runTableQuery(request)).resolves.toEqual({ status: "success", result, demo: false });
    expect(query).toHaveBeenCalledWith(request, undefined);

    query.mockRejectedValueOnce(new Error("boom"));
    await expect(runTableQuery(request)).resolves.toEqual({ status: "error", code: "unknown", message: "boom" });
  });
});

describe("spec validation", () => {
  it("the demo passes every spec and asks nothing", async () => {
    const validate = vi.spyOn(builderApi, "validate");
    await expect(demoValidationClient.validate({} as BuildSpec)).resolves.toEqual({ valid: true, errors: [] });
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("monitoring", () => {
  it("the demo answers with its fixture and asks nothing", async () => {
    const summary = vi.spyOn(builderApi, "getMonitoringSummary");
    const data = await monitoringClient().load();
    expect(data.summary.status).toBe("healthy");
    expect(summary).not.toHaveBeenCalled();
  });
});

describe("the version check", () => {
  it("resolves in the demo without asking, and records nothing", async () => {
    const version = vi.spyOn(builderApi, "version");
    await ensureVersionChecked();
    expect(version).not.toHaveBeenCalled();
    expect(useVersionCheckStore.getState().apiVersion).toBeNull();
  });

  it("asks Builder once one is configured", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const version = vi
      .spyOn(builderApi, "version")
      .mockResolvedValue({ version: "0.4.0", api_version: "1.69.0" } as Awaited<ReturnType<typeof builderApi.version>>);
    await ensureVersionChecked();
    expect(version).toHaveBeenCalledTimes(1);
    expect(useVersionCheckStore.getState().apiVersion).toBe("1.69.0");
  });
});
