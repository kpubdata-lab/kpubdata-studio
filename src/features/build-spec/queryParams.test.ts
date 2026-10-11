/**
 * The parameter form's reading and writing of the request parameters' JSON (#899).
 */
import { describe, expect, it } from "vitest";
import type { CatalogQueryParameter } from "@/shared/lib/builderApi";
import { catalogDatasetSchema } from "@/shared/lib/builderApi.schema";
import { applyBuildSpecToDraft, buildSpecFromDraft, INITIAL_DRAFT } from "@/features/add-data/model";
import { toBuildSpec, toFormValues } from "./newBuildModel";
import { checkQueryParams, paramsObject, readQueryParam, writeQueryParam } from "./queryParams";
import { fromYamlText } from "./yamlText";

function param(overrides: Partial<CatalogQueryParameter>): CatalogQueryParameter {
  return {
    name: "p",
    alias: null,
    type: "string",
    required: false,
    enum: null,
    description: null,
    example: null,
    ...overrides,
  };
}

const station = param({ name: "stationName", alias: "station", required: true, example: "백령도" });
const term = param({ name: "dataTerm", alias: "term", required: true, enum: ["daily", "month", "3month"] });
const ver = param({ name: "ver" });

describe("reading and writing a parameter", () => {
  it("writes the alias, and keeps every other key with its value and order", () => {
    const text = writeQueryParam('{"returnType":"json","numOfRows":10}', station, "강남구");
    expect(JSON.parse(text)).toEqual({ returnType: "json", numOfRows: 10, station: "강남구" });
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["returnType", "numOfRows", "station"]);
  });

  it("writes the provider's name when the parameter has no alias", () => {
    expect(JSON.parse(writeQueryParam("{}", ver, "1.3"))).toEqual({ ver: "1.3" });
  });

  it("reads a saved spec that used the provider's name, and replaces that spelling in place", () => {
    const saved = '{"stationName":"백령도","ver":"1.3"}';
    expect(readQueryParam(paramsObject(saved)!, station)).toBe("백령도");
    expect(writeQueryParam(saved, station, "수내동")).toBe(JSON.stringify({ station: "수내동", ver: "1.3" }, null, 2));
  });

  it("removes the parameter when the value is emptied", () => {
    expect(JSON.parse(writeQueryParam('{"station":"백령도","ver":"1.3"}', station, ""))).toEqual({ ver: "1.3" });
  });

  it("reads a saved number as text and leaves it a number until it is edited", () => {
    const saved = '{"pageSize":5}';
    const size = param({ name: "pageSize", type: "integer" });
    expect(readQueryParam(paramsObject(saved)!, size)).toBe("5");
    expect(writeQueryParam(saved, ver, "1.3")).toContain('"pageSize": 5');
  });

  it("leaves a text that is not a JSON object alone", () => {
    expect(paramsObject("{not json")).toBeNull();
    expect(paramsObject("[1]")).toBeNull();
    expect(writeQueryParam("{not json", station, "x")).toBe("{not json");
  });
});

describe("checking the parameters before review", () => {
  it("names each required parameter that is missing or blank", () => {
    const error = checkQueryParams('{"term":"  "}', [station, term, ver]);
    expect(error).toContain("station");
    expect(error).toContain("term");
    expect(error).not.toContain("ver");
  });

  it("passes when every required parameter has a value, under either spelling", () => {
    expect(checkQueryParams('{"stationName":"백령도","term":"daily"}', [station, term, ver])).toBeUndefined();
  });

  it("refuses a value outside the enum", () => {
    expect(checkQueryParams('{"station":"x","term":"weekly"}', [station, term])).toContain("daily, month, 3month");
  });

  it("checks the format of typed values", () => {
    const day = param({ name: "base_date", type: "date_yyyymmdd" });
    const month = param({ name: "deal_ym", type: "date_yyyymm" });
    const rows = param({ name: "rows", type: "integer" });
    const ratio = param({ name: "ratio", type: "number" });
    expect(checkQueryParams('{"base_date":"2026-10-12"}', [day])).toBeDefined();
    expect(checkQueryParams('{"base_date":"20261012"}', [day])).toBeUndefined();
    expect(checkQueryParams('{"deal_ym":"202613"}', [month])).toBeDefined();
    expect(checkQueryParams('{"deal_ym":"202610"}', [month])).toBeUndefined();
    expect(checkQueryParams('{"rows":"1.5"}', [rows])).toBeDefined();
    expect(checkQueryParams('{"rows":10}', [rows])).toBeUndefined();
    expect(checkQueryParams('{"ratio":"0.25"}', [ratio])).toBeUndefined();
    expect(checkQueryParams('{"ratio":"a"}', [ratio])).toBeDefined();
  });

  it("does not invent a format for a parameter whose type is unknown", () => {
    expect(checkQueryParams('{"q":"anything 1-2"}', [param({ name: "q", type: null })])).toBeUndefined();
  });

  it("checks nothing when there is no definition, and leaves bad JSON to the JSON check", () => {
    expect(checkQueryParams("{}", null)).toBeUndefined();
    expect(checkQueryParams("{}", undefined)).toBeUndefined();
    expect(checkQueryParams("{oops", [station])).toBeUndefined();
  });
});

describe("the catalog's query_parameters", () => {
  const dataset = {
    name: "air_station",
    title: "측정소별 실시간 대기측정정보",
    description: null,
    tags: [],
    source_url: null,
    representation: "api_json",
    operations: ["list"],
    query_support: null,
    requires_service_key: true,
  };

  it("reads null and absent as no definition", () => {
    expect(catalogDatasetSchema.parse({ ...dataset, query_parameters: null }).query_parameters).toBeNull();
    expect(catalogDatasetSchema.parse(dataset).query_parameters).toBeUndefined();
  });

  it("reads a type this Studio does not know as null, not as a failed catalog", () => {
    const parsed = catalogDatasetSchema.parse({
      ...dataset,
      query_parameters: [{ ...station, type: "datetime_iso" }],
    });
    expect(parsed.query_parameters?.[0].type).toBeNull();
  });
});

describe("a saved spec through the form", () => {
  const SAVED = `dataset_id: air-station
title: Air station
description: Station measurements
sources:
  - provider: datago
    dataset: air_station
    params:
      stationName: 백령도
      numOfRows: 100
exports:
  - kind: jsonl
    output_path: out/data.jsonl
metadata:
  outputPath: out
`;

  it("loads into Create table's draft, takes a field's edit, and keeps everything else", () => {
    const draft = applyBuildSpecToDraft(INITIAL_DRAFT, fromYamlText(SAVED));
    expect(readQueryParam(paramsObject(draft.publicApi.sourceParams)!, station)).toBe("백령도");

    const sourceParams = writeQueryParam(draft.publicApi.sourceParams, term, "daily");
    const { spec } = buildSpecFromDraft({ ...draft, publicApi: { ...draft.publicApi, sourceParams } });
    expect(spec?.sources[0].params).toEqual({ stationName: "백령도", numOfRows: 100, term: "daily" });
  });

  it("loads into the spec editor, takes a field's edit, and keeps everything else", () => {
    const base = fromYamlText(SAVED);
    const values = toFormValues(base);
    const edited = { ...values, sourceParams: writeQueryParam(values.sourceParams, station, "수내동") };
    const { spec } = toBuildSpec(edited, base);
    expect(spec?.sources[0].params).toEqual({ station: "수내동", numOfRows: 100 });
  });

  it("is unchanged when no field is touched", () => {
    const base = fromYamlText(SAVED);
    expect(toBuildSpec(toFormValues(base), base).spec?.sources[0].params).toEqual({ stationName: "백령도", numOfRows: 100 });
  });
});
