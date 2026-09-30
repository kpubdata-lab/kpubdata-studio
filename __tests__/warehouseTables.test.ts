/**
 * A warehouse table's dataset and source key, read as Builder writes the name (#602).
 *
 * Builder names a table `<dataset_id>.<source_key>` and its `table_key` takes everything
 * after the `<dataset_id>.` prefix, so dots on either side must survive. The Tables list
 * and the table detail decide ownership with the same function.
 */
import { describe, expect, it } from "vitest";

import { datasetTablesOf, sourceKeyOf, sourceKeyUnder, tableOwnerAmong } from "@/features/datasets/warehouseTables";
import type { WarehouseTable } from "@/shared/lib/builderApi";

const table = (logical_name: string, dataset_id?: string | null): WarehouseTable => ({
  table_id: logical_name,
  logical_name,
  current_snapshot_id: "snap_1",
  revision: 1,
  ...(dataset_id === undefined ? {} : { dataset_id }),
});

describe("sourceKeyUnder (Builder's table_key)", () => {
  it("keeps the whole rest of the name after the dataset prefix", () => {
    expect(sourceKeyUnder("seoul-air-quality.datago.air_quality", "seoul-air-quality")).toBe("datago.air_quality");
    expect(sourceKeyUnder("seoul.air.datago.air_quality", "seoul.air")).toBe("datago.air_quality");
  });

  it("is null for another dataset, a bare prefix or an empty key", () => {
    expect(sourceKeyUnder("seoul-air-quality.datago.air_quality", "seoul-air")).toBeNull();
    expect(sourceKeyUnder("seoul-air-qualityX.datago", "seoul-air-quality")).toBeNull();
    expect(sourceKeyUnder("seoul-air-quality.", "seoul-air-quality")).toBeNull();
    expect(sourceKeyUnder("seoul-air-quality", "seoul-air-quality")).toBeNull();
    expect(sourceKeyUnder(".datago", "")).toBeNull();
  });
});

describe("sourceKeyOf / datasetTablesOf — the table detail (#602)", () => {
  it("keeps a provider.dataset source key of a source without an alias", () => {
    const air = table("seoul-air-quality.datago.air_quality", "seoul-air-quality");
    expect(sourceKeyOf(air, "seoul-air-quality")).toBe("datago.air_quality");
    expect(datasetTablesOf([air], "seoul-air-quality")).toEqual([air]);
  });

  it("keeps an alias that contains a dot", () => {
    expect(sourceKeyOf(table("air.stations.v2", "air"), "air")).toBe("stations.v2");
  });

  it("reads a dataset id that contains a dot", () => {
    expect(sourceKeyOf(table("seoul.air.datago.air_quality", "seoul.air"), "seoul.air")).toBe("datago.air_quality");
  });

  it("leaves out a table of another dataset, even one whose id extends this one", () => {
    const tables = [
      table("seoul.datago.air_quality", "seoul"),
      table("seoul.air.datago.air_quality", "seoul.air"),
      table("busan.datago.air_quality", "busan"),
    ];
    expect(datasetTablesOf(tables, "seoul").map((entry) => entry.logical_name)).toEqual(["seoul.datago.air_quality"]);
    expect(datasetTablesOf(tables, "seoul.air").map((entry) => entry.logical_name)).toEqual(["seoul.air.datago.air_quality"]);
  });

  it("attributes no table Builder could not attribute (dataset_id null)", () => {
    expect(sourceKeyOf(table("air.datago.air_quality", null), "air")).toBeNull();
    expect(datasetTablesOf([table("air.datago.air_quality", null)], "air")).toEqual([]);
  });

  it("matches an older Builder's table (dataset_id omitted) by the dataset prefix", () => {
    expect(sourceKeyOf(table("air.datago.air_quality"), "air")).toBe("datago.air_quality");
    expect(sourceKeyOf(table("air.datago.air_quality"), "air.datago")).toBe("air_quality");
    expect(sourceKeyOf(table("busan.datago.air_quality"), "air")).toBeNull();
  });
});

describe("tableOwnerAmong — the Tables list (#602)", () => {
  it("takes Builder's dataset_id when it is one of the datasets, and nothing else", () => {
    expect(tableOwnerAmong(table("seoul.air.datago.air_quality", "seoul.air"), new Set(["seoul", "seoul.air"]))).toEqual({
      datasetId: "seoul.air",
      sourceKey: "datago.air_quality",
    });
    expect(tableOwnerAmong(table("seoul.air.datago.air_quality", "seoul.air"), new Set(["seoul"]))).toBeNull();
  });

  it("gives an older Builder's table to the longest dataset id its name starts with", () => {
    expect(tableOwnerAmong(table("seoul.air.datago.air_quality"), new Set(["seoul", "seoul.air", "busan"]))).toEqual({
      datasetId: "seoul.air",
      sourceKey: "datago.air_quality",
    });
    expect(tableOwnerAmong(table("seoul.datago.air_quality"), new Set(["seoul", "seoul.air"]))).toEqual({
      datasetId: "seoul",
      sourceKey: "datago.air_quality",
    });
    expect(tableOwnerAmong(table("daegu.datago.air_quality"), new Set(["seoul"]))).toBeNull();
  });
});
