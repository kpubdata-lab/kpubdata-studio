// @vitest-environment jsdom
/**
 * Whether adding a dataset would replace a table that is already there (#837).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAuthRenewalForTests, type WarehouseTable } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import type { BuildSpec } from "@/shared/lib/types";
import {
  datasetIdToBuild,
  existingTablesAmong,
  sameExistingTables,
  findExistingTables,
  freeDatasetId,
  specToBuild,
  type ExistingTables,
} from "./existingTables";

/** A table as Builder lists it. `datasetId` undefined is an older Builder that does not send it. */
function table(logicalName: string, datasetId?: string | null, rows: number | null = 22): WarehouseTable {
  return {
    table_id: `tbl_${logicalName}`,
    logical_name: logicalName,
    current_snapshot_id: "snap_1",
    revision: 1,
    current_snapshot: { snapshot_id: "snap_1", row_count: rows, committed_at: "2026-10-08T01:00:00Z", coverage: null },
    ...(datasetId === undefined ? {} : { dataset_id: datasetId }),
  };
}

const STATIONS = table("datago-air-station.datago.air_station", "datago-air-station");

const SPEC: BuildSpec = {
  datasetId: "datago-air-station",
  title: "Air stations",
  description: "Measuring stations",
  sources: [{ provider: "datago", dataset: "air_station", params: { station: "B" } }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

describe("existingTablesAmong", () => {
  it("finds the table the dataset id already has, and the id that is free", () => {
    const found = existingTablesAmong("datago-air-station", [table("other.x", "other"), STATIONS], ["datago.air_station"]);

    expect(found).toStrictEqual({
      status: "found",
      tables: [STATIONS],
      replaced: [STATIONS],
      freeId: "datago-air-station-2",
      freeNumber: 2,
    });
  });

  it("finds every table of a dataset with several sources", () => {
    const first = table("weather.a", "weather");
    const second = table("weather.b", "weather");

    expect(existingTablesAmong("weather", [first, table("weather-2.a", "weather-2"), second], ["a", "b"])).toStrictEqual({
      status: "found",
      tables: [first, second],
      replaced: [first, second],
      freeId: "weather-3",
      freeNumber: 3,
    });
  });

  it("tells a table the build would replace from one that only shares the id", () => {
    // Two uploads under one id: every upload is a source key, and a table, of its own.
    const earlier = table("report.file.upl_1", "report");

    const found = existingTablesAmong("report", [earlier], ["file.upl_2"]);

    expect(found).toMatchObject({ status: "found", tables: [earlier], replaced: [], freeId: "report-2" });
  });

  it("takes every table under the id as replaced while the names it would make are not known", () => {
    const earlier = table("report.file.upl_1", "report");

    expect(existingTablesAmong("report", [earlier])).toMatchObject({ status: "found", replaced: [earlier] });
  });

  it("reads an older Builder's tables by their names", () => {
    const old = table("datago-air-station.datago.air_station");

    expect(existingTablesAmong("datago-air-station", [old], ["datago.air_station"])).toMatchObject({
      status: "found",
      tables: [old],
      replaced: [old],
    });
  });

  it("counts a table Builder could not attribute, when its name is under the id", () => {
    // `dataset_id: null`: Builder could not read the run's spec. The Tables screen does
    // not guess whose it is; here a wrong "none" would let the build overwrite it.
    const unattributed = table("datago-air-station.datago.air_station", null);

    expect(existingTablesAmong("datago-air-station", [unattributed], ["datago.air_station"])).toStrictEqual({
      status: "found",
      tables: [unattributed],
      replaced: [unattributed],
      freeId: "datago-air-station-2",
      freeNumber: 2,
    });
    // Not one whose name merely begins the same way.
    expect(existingTablesAmong("datago-air", [unattributed], ["station"])).toStrictEqual({ status: "none" });
  });

  it("counts a table of another dataset whose name is exactly one the build would make", () => {
    // Dataset `seoul` with source `air.pm` and dataset `seoul.air` with source `pm` are
    // one table name.
    const sameName = table("seoul.air.pm", "seoul.air");

    expect(existingTablesAmong("seoul", [sameName], ["air.pm"])).toMatchObject({
      status: "found",
      tables: [sameName],
      replaced: [sameName],
    });
    expect(existingTablesAmong("seoul", [sameName], ["air.o3"])).toStrictEqual({ status: "none" });
  });

  it("says none when no table is under the id", () => {
    // A table whose name starts with the id but which Builder says is another dataset's.
    const other = table("datago-air-station.x", "datago-air-station-archive");

    expect(
      existingTablesAmong("datago-air-station", [other, table("datago-air.y", "datago-air")], ["datago.air_station"]),
    ).toStrictEqual({ status: "none" });
    expect(existingTablesAmong("datago-air-station", [], ["datago.air_station"])).toStrictEqual({ status: "none" });
  });
});

describe("freeDatasetId", () => {
  it("skips the suffixes that already have a table", () => {
    const tables = [STATIONS, table("datago-air-station-2.s", "datago-air-station-2"), table("datago-air-station-3.s", "datago-air-station-3")];

    expect(freeDatasetId("datago-air-station", tables)).toStrictEqual({ id: "datago-air-station-4", number: 4 });
  });

  it("skips a suffix whose table Builder could not attribute, or whose name the build would make", () => {
    const tables = [table("air-2.pm", null), table("air-3.pm", "air-3.archive")];

    expect(freeDatasetId("air", tables, ["pm"])).toStrictEqual({ id: "air-4", number: 4 });
  });

  it("stays inside the length a dataset id may have", () => {
    const long = "a".repeat(80);

    const free = freeDatasetId(long, [table(`${long}.s`, long)]);

    expect(free.id).toBe(`${"a".repeat(78)}-2`);
    expect(free.id).toHaveLength(80);
  });
});

describe("datasetIdToBuild and specToBuild", () => {
  const found: ExistingTables = {
    status: "found",
    tables: [STATIONS],
    replaced: [STATIONS],
    freeId: "datago-air-station-2",
    freeNumber: 2,
  };

  it("builds under the free id unless the user chose the same one", () => {
    expect(datasetIdToBuild("datago-air-station", found, "new")).toBe("datago-air-station-2");
    expect(datasetIdToBuild("datago-air-station", found, "same")).toBe("datago-air-station");
  });

  it.each<ExistingTables>([{ status: "none" }, { status: "checking" }, { status: "unknown" }])(
    "keeps the id when the answer is $status",
    (existing) => {
      expect(datasetIdToBuild("datago-air-station", existing, "new")).toBe("datago-air-station");
    },
  );

  it("changes the id and numbers the title, nothing else, and not the spec it was given", () => {
    const built = specToBuild(SPEC, found, "new");

    expect(built).toStrictEqual({ ...SPEC, datasetId: "datago-air-station-2", title: "Air stations (2)" });
    expect(SPEC).toMatchObject({ datasetId: "datago-air-station", title: "Air stations" });
    expect(specToBuild(SPEC, found, "same")).toBe(SPEC);
    expect(specToBuild(SPEC, { status: "none" }, "new")).toBe(SPEC);
  });
});

describe("findExistingTables", () => {
  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  /** A Builder whose table list is `answer`. Records the paths it was asked for. */
  function builder(answer: () => Promise<Response> | Response): string[] {
    const asked: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const signal = init?.signal ?? undefined;
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      asked.push(new URL(String(input), "http://builder.test").pathname);
      return answer();
    });
    return asked;
  }

  beforeEach(() => {
    clearSessionRefusal();
    resetAuthRenewalForTests();
    window.__KPUBDATA_CONFIG__ = { useRealBuilder: "true" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__KPUBDATA_CONFIG__;
  });

  it("asks Builder for the caller's tables and finds the one of this id", async () => {
    const asked = builder(() => json(200, { tables: [STATIONS] }));

    const existing = await findExistingTables("datago-air-station", undefined, ["datago.air_station"]);

    expect(existing).toStrictEqual({
      status: "found",
      tables: [STATIONS],
      replaced: [STATIONS],
      freeId: "datago-air-station-2",
      freeNumber: 2,
    });
    expect(asked.filter((path) => path.endsWith("/warehouse/tables"))).toHaveLength(1);
  });

  it("uses the id it was given", async () => {
    builder(() => json(200, { tables: [STATIONS] }));

    expect(await findExistingTables("something-else")).toStrictEqual({ status: "none" });
  });

  it("reads a deployment without a warehouse as having no table to replace", async () => {
    builder(() => json(404, { error: "warehouse_not_configured" }));

    expect(await findExistingTables("datago-air-station")).toStrictEqual({ status: "none" });
  });

  it.each([500, 503, 403])("does not read a %i as no table", async (status) => {
    builder(() => json(status, { error: "nope" }));

    expect(await findExistingTables("datago-air-station")).toStrictEqual({ status: "unknown" });
  });

  it("does not read an unreachable Builder as no table", async () => {
    builder(() => {
      throw new TypeError("network down");
    });

    expect(await findExistingTables("datago-air-station")).toStrictEqual({ status: "unknown" });
  });

  it("rejects, without an answer, when the question was withdrawn", async () => {
    const asked = builder(() => json(200, { tables: [STATIONS] }));
    const controller = new AbortController();
    controller.abort();

    await expect(findExistingTables("datago-air-station", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(asked).toEqual([]);
  });

  it("asks the demo warehouse in the demo", async () => {
    delete window.__KPUBDATA_CONFIG__;
    const asked = builder(() => json(500, {}));

    const existing = await findExistingTables("air-quality");

    expect(existing.status).toBe("found");
    expect(asked).toEqual([]);
  });
});

describe("sameExistingTables (#861)", () => {
  const ID = "datago-air-station";
  const KEYS = ["datago.air_station"];

  it("is the same answer when the tables and the free id are", () => {
    const shown = existingTablesAmong(ID, [STATIONS], KEYS);
    const again = existingTablesAmong(ID, [table(STATIONS.logical_name, ID, 999)], KEYS);

    // Row counts are not what the step decided on.
    expect(sameExistingTables(shown, again)).toBe(true);
  });

  it("is a different answer when the free id was taken meanwhile", () => {
    const shown = existingTablesAmong(ID, [STATIONS], KEYS);
    const again = existingTablesAmong(ID, [STATIONS, table(`${ID}-2.datago.air_station`, `${ID}-2`)], KEYS);

    expect(sameExistingTables(shown, again)).toBe(false);
  });

  it("is a different answer when a table appeared or went", () => {
    const none = existingTablesAmong(ID, [], KEYS);
    const found = existingTablesAmong(ID, [STATIONS], KEYS);

    expect(sameExistingTables(none, found)).toBe(false);
    expect(sameExistingTables(found, none)).toBe(false);
    expect(sameExistingTables(none, existingTablesAmong(ID, [], KEYS))).toBe(true);
  });
});
