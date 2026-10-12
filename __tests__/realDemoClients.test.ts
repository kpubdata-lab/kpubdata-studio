/**
 * The clients #902 moved behind one interface choose by the deployment, and each side
 * answers as the screen answered before the move.
 *
 * - SQL: Builder's rows, or its refusal classified; the demo's fixed rows, marked `demo`.
 * - Spec validation: the demo passes every spec without a request.
 * - Monitoring: the demo's fixture, with no request; Builder's two reads together.
 * - The version check: the demo resolves without a request and records nothing.
 * - Connections: the demo's key store keeps nothing, its test and probe ask nothing.
 * - The assistant: the demo answers turns itself and refuses to run SQL (`mock_mode`).
 * - Report evidence: the demo vouches for no output, and does not read a manifest.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { assistantClient, demoAssistantClient, realAssistantClient } from "@/features/assistant/query";
import { demoMonitoringClient, monitoringClient, realMonitoringClient } from "@/features/monitoring/api/client";
import { DEMO_PROVIDERS, demoProviderClient, providerClient, realProviderClient } from "@/features/provider/client";
import { demoOutputEvidence, outputEvidence, realOutputEvidence } from "@/features/reports/evidence";
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
    ["connections", providerClient, realProviderClient, demoProviderClient],
    ["assistant", assistantClient, realAssistantClient, demoAssistantClient],
    ["report output evidence", outputEvidence, realOutputEvidence, demoOutputEvidence],
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

describe("connections", () => {
  it("the demo answers from its own providers and asks nothing", async () => {
    const calls = [
      vi.spyOn(builderApi, "getProviderCredential"),
      vi.spyOn(builderApi, "putProviderCredential"),
      vi.spyOn(builderApi, "deleteProviderCredential"),
      vi.spyOn(builderApi, "testProviderConnection"),
      vi.spyOn(builderApi, "probeProviderKey"),
    ];
    const client = providerClient();
    expect(DEMO_PROVIDERS.map((summary) => [summary.provider, summary.configured])).toEqual([
      ["datago", false],
      ["kosis", true],
      ["g2b", false],
    ]);
    await expect(client.credential("kosis")).resolves.toMatchObject({ configured: true, masked: "ab••••yz" });
    await expect(client.credential("datago")).resolves.toMatchObject({ configured: false, masked: null, updated_at: null });
    await expect(client.saveCredential("datago", "secret")).resolves.toBeUndefined();
    await expect(client.deleteCredential("kosis")).resolves.toBeUndefined();
    // A key saved in the demo is not kept: the provider still reads as having none.
    await expect(client.credential("datago")).resolves.toMatchObject({ configured: false });
    await expect(client.test("kosis")).resolves.toMatchObject({ status: "connected" });
    await expect(client.test("datago")).resolves.toMatchObject({ status: "not_configured" });
    await expect(client.test("unknown")).resolves.toMatchObject({ status: "connected" });
    const probe = await client.probe("datago");
    expect(probe.datasets.map((row) => row.status)).toEqual(["available", "application_required"]);
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });
});

describe("the assistant", () => {
  it("the demo answers turns itself and refuses to run SQL", async () => {
    const query = vi.spyOn(builderApi, "query");
    expect(assistantClient().demo).toBe(true);
    await expect(assistantClient().runQuery(request)).resolves.toMatchObject({ status: "error", code: "mock_mode" });
    expect(query).not.toHaveBeenCalled();
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    expect(assistantClient().demo).toBe(false);
  });
});

describe("report output evidence", () => {
  it("the demo vouches for no output and reads no manifest", async () => {
    const manifest = vi.spyOn(builderApi, "getBuildManifest");
    await expect(outputEvidence().output("run-1")).resolves.toMatchObject({ ok: false });
    expect(manifest).not.toHaveBeenCalled();
  });
});
