/**
 * The generator behind `generated/builderEnums.ts`, and the snapshot it wrote (#793).
 *
 * Whether the snapshot matches Builder's contract is asked in `contractDrift.test.ts`,
 * the file the contract jobs run with the contract in hand. These tests need no contract:
 * they hold the generator's rules, and that the hand-written schemas really take their
 * enums from the snapshot.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectEnums, main, renderBuilderEnums } from "../../../scripts/generate-builder-enums.mjs";
import { BUILDER_ENUMS, BUILDER_ENUMS_CONTRACT_VERSION, builderEnum } from "./builderEnums";
import { buildJobSchema } from "./builderApi.schema";

const CONTRACT = {
  info: { version: "9.9.9" },
  components: {
    schemas: {
      Colour: { type: "string", enum: ["red", "green"] },
      Job: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["queued", "running"], default: "queued", example: "running" },
          // A property may be called `items` or `enum`; under `properties` it is a name.
          items: { type: "array", items: { type: "string", enum: ["a", "b"] } },
          enum: { type: "string", enum: ["x"] },
          nested: { type: "object", properties: { kind: { enum: ["k1", "k2"] } } },
          flag: { enum: [true, null] },
        },
      },
      Refusal: { allOf: [{ $ref: "#/components/schemas/Error" }, { properties: { code: { enum: ["refused"] } } }] },
      Either: { oneOf: [{ properties: { left: { enum: ["l"] } } }, { properties: { right: { enum: ["r"] } } }] },
      Plain: { type: "object", properties: { name: { type: "string" } } },
    },
  },
};

afterEach(() => vi.restoreAllMocks());

describe("collectEnums", () => {
  it("names an enum by its schema and the properties that lead to it", () => {
    expect(collectEnums(CONTRACT)).toEqual([
      ["Colour", ["red", "green"]],
      ["Either.left", ["l"]],
      ["Either.right", ["r"]],
      ["Job.enum", ["x"]],
      ["Job.flag", [true, null]],
      ["Job.items", ["a", "b"]],
      ["Job.nested.kind", ["k1", "k2"]],
      ["Job.status", ["queued", "running"]],
      ["Refusal.code", ["refused"]],
    ]);
  });

  it("keeps the values in the contract's order and sorts only the names", () => {
    const contract = { components: { schemas: { Z: { enum: ["b", "a", "c"] }, A: { enum: ["z", "y"] } } } };

    expect(collectEnums(contract)).toEqual([
      ["A", ["z", "y"]],
      ["Z", ["b", "a", "c"]],
    ]);
  });

  it("refuses two enums that would share a name with different values", () => {
    const contract = {
      components: {
        schemas: { Thing: { oneOf: [{ properties: { kind: { enum: ["a"] } } }, { properties: { kind: { enum: ["b"] } } }] } },
      },
    };

    expect(() => collectEnums(contract)).toThrow("both named Thing.kind");
  });

  it("lets the same enum be declared twice under one name", () => {
    const contract = {
      components: {
        schemas: { Thing: { oneOf: [{ properties: { kind: { enum: ["a"] } } }, { properties: { kind: { enum: ["a"] } } }] } },
      },
    };

    expect(collectEnums(contract)).toEqual([["Thing.kind", ["a"]]]);
  });

  it("finds nothing in a contract with no schemas, and reads no enum out of an example", () => {
    expect(collectEnums({})).toEqual([]);
    expect(collectEnums({ components: { schemas: { A: { example: { enum: ["not-one"] } } } } })).toEqual([]);
  });
});

describe("renderBuilderEnums", () => {
  it("gives the same text for the same contract, whatever order its schemas are in", () => {
    const reversed = {
      ...CONTRACT,
      components: { schemas: Object.fromEntries(Object.entries(CONTRACT.components.schemas).reverse()) },
    };

    expect(renderBuilderEnums(CONTRACT)).toBe(renderBuilderEnums(CONTRACT));
    expect(renderBuilderEnums(reversed)).toBe(renderBuilderEnums(CONTRACT));
  });

  it("records the contract version it was made from", () => {
    expect(renderBuilderEnums(CONTRACT)).toContain('export const BUILDER_ENUMS_CONTRACT_VERSION = "9.9.9";');
  });

  it("refuses a contract that names no version", () => {
    expect(() => renderBuilderEnums({ components: { schemas: {} } })).toThrow("no info.version");
  });
});

describe("the --check gate", () => {
  function files(snapshot: string | null) {
    const directory = mkdtempSync(join(tmpdir(), "builder-enums-"));
    const contract = join(directory, "contract.json");
    // JSON is YAML: the generator reads it as the contract.
    writeFileSync(contract, JSON.stringify(CONTRACT), "utf8");
    const output = join(directory, "builderEnums.ts");
    if (snapshot !== null) writeFileSync(output, snapshot, "utf8");
    return { contract, output };
  }

  it("passes on a fresh snapshot and fails on a stale, edited or missing one", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fresh = files(renderBuilderEnums(CONTRACT));
    const edited = files(renderBuilderEnums(CONTRACT).replace('"queued"', '"waiting"'));
    const missing = files(null);

    expect(main(["--contract", fresh.contract, "--check"], fresh.output)).toBe(0);
    expect(main(["--contract", edited.contract, "--check"], edited.output)).toBe(1);
    expect(main(["--contract", missing.contract, "--check"], missing.output)).toBe(1);
  });

  it("writes what the check then accepts", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { contract, output } = files("stale");

    expect(main(["--contract", contract], output)).toBe(0);
    expect(readFileSync(output, "utf8")).toBe(renderBuilderEnums(CONTRACT));
    expect(main(["--contract", contract, "--check"], output)).toBe(0);
  });

  it("says so when it has no contract to read, and writes nothing", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("BUILDER_CONTRACT", "");
    const { output } = files("untouched");

    expect(main([], output)).toBe(2);
    expect(main(["--contract", join(tmpdir(), "no-such-contract.yaml")], output)).toBe(2);
    expect(readFileSync(output, "utf8")).toBe("untouched");
    expect(errors).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("the snapshot in use", () => {
  it("names a contract version and holds the enums Studio decides by", () => {
    expect(BUILDER_ENUMS_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BUILDER_ENUMS["BuildJob.status"]).toEqual(["queued", "running", "cancelling", "succeeded", "failed", "cancelled"]);
    expect(Object.keys(BUILDER_ENUMS).length).toBeGreaterThan(100);
  });

  it("builderEnum is strict: a value the snapshot does not hold fails the parse", () => {
    const status = builderEnum("BuildJob.status");

    expect(status.parse("queued")).toBe("queued");
    expect(status.safeParse("paused").success).toBe(false);
    expect(status.options).toEqual([...BUILDER_ENUMS["BuildJob.status"]]);
  });

  it("the hand-written schema takes its enum from the snapshot", () => {
    const job = { run_id: "r", created_at: "t", updated_at: "t" };

    for (const status of BUILDER_ENUMS["BuildJob.status"]) {
      expect(buildJobSchema.safeParse({ ...job, status }).success, status).toBe(true);
    }
    expect(buildJobSchema.safeParse({ ...job, status: "paused" }).success).toBe(false);
  });

  it("an unknown value where the field says it may be ignored does not fail the parse", () => {
    // `BuildJob.code` is a plain string on purpose: a reason added later must not make
    // the whole job unreadable (#787). The policy is the field's, not the generator's.
    const job = { run_id: "r", status: "failed", created_at: "t", updated_at: "t", code: "a_reason_added_later" };

    expect(buildJobSchema.safeParse(job).success).toBe(true);
  });
});
