/**
 * Studio's response schemas against Builder's contract (kpubdata-builder#693).
 *
 * Studio validates every Builder response with the hand-written Zod schemas in
 * builderApi.schema.ts. When Builder adds an enum value Studio has not listed, every
 * response carrying it fails to parse — `run_cancelled` did exactly that from
 * builder#481 until Studio #473. Nothing compared the two.
 *
 * For each contract schema that Studio mirrors by name (`BuildEventName` →
 * `buildEventNameSchema`), this checks the two failure modes that break parsing:
 *
 * - a contract enum value Studio's enum does not accept;
 * - a key Studio requires that the contract does not define.
 *
 * The contract is read from `BUILDER_CONTRACT` (CI checks out Builder's main). Run
 * locally with `BUILDER_CONTRACT=../kpubdata-builder/contract/builder-api.yaml`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import * as schemas from "./builderApi.schema";

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  $ref?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
};

const contractPath = process.env.BUILDER_CONTRACT;

const studioName = (contractName: string) =>
  `${contractName[0].toLowerCase()}${contractName.slice(1)}Schema`;

/** Peel wrappers Studio adds (nullable, optional, default) down to the core schema. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema;
  for (;;) {
    const def = (current as unknown as { def: { type: string; innerType?: z.ZodType } }).def;
    if (def.innerType && ["nullable", "optional", "default", "catch", "readonly"].includes(def.type)) {
      current = def.innerType;
      continue;
    }
    return current;
  }
}

function enumOptions(schema: z.ZodType): unknown[] | null {
  const core = unwrap(schema) as unknown as {
    def: { type: string; entries?: Record<string, unknown>; options?: z.ZodType[] };
  };
  // An extensible enum (`wireEncodingSchema`, #497) is a union whose first branch is the
  // known values: parsing never fails on a new one, but a value Studio shows as
  // "unsupported" is still drift worth reporting.
  if (core.def.type === "union" && core.def.options?.[0]) return enumOptions(core.def.options[0]);
  if (core.def.type !== "enum" || !core.def.entries) return null;
  return Object.values(core.def.entries);
}

function requiredKeys(schema: z.ZodType): string[] | null {
  const core = unwrap(schema) as unknown as { def: { type: string; shape?: Record<string, z.ZodType> } };
  if (core.def.type !== "object" || !core.def.shape) return null;
  return Object.entries(core.def.shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
}

/** Inline enum of a contract schema, directly or through a nullable oneOf/anyOf. */
function contractEnum(schema: JsonSchema): unknown[] | null {
  if (schema.enum) return schema.enum.filter((value) => value !== null);
  for (const branch of [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) {
    if (branch.enum) return branch.enum.filter((value) => value !== null);
  }
  return null;
}

function contractProperties(schema: JsonSchema): Set<string> | null {
  const names = new Set<string>();
  let found = false;
  for (const part of [schema, ...(schema.allOf ?? [])]) {
    if (part.properties) {
      found = true;
      for (const key of Object.keys(part.properties)) names.add(key);
    }
  }
  return found ? names : null;
}

describe.skipIf(!contractPath)("Builder contract drift", () => {
  const contract = contractPath
    ? (parse(readFileSync(contractPath, "utf-8")) as {
        components: { schemas: Record<string, JsonSchema> };
      })
    : { components: { schemas: {} } };
  const mirrored = Object.entries(contract.components.schemas).filter(
    ([name]) => studioName(name) in schemas,
  );
  const studio = schemas as unknown as Record<string, z.ZodType>;

  it("mirrors a meaningful part of the contract by name", () => {
    // If a rename made nothing match, the checks below would pass on nothing.
    expect(mirrored.length).toBeGreaterThan(30);
  });

  it.each(mirrored)("%s: accepts every enum value the contract allows", (name, schema) => {
    const values = contractEnum(schema);
    const accepted = enumOptions(studio[studioName(name)]);
    if (values === null || accepted === null) return;
    expect(values.filter((value) => !accepted.includes(value))).toEqual([]);
  });

  it.each(mirrored)("%s: requires no key the contract does not define", (name, schema) => {
    const defined = contractProperties(schema);
    const required = requiredKeys(studio[studioName(name)]);
    if (defined === null || required === null) return;
    expect(required.filter((key) => !defined.has(key))).toEqual([]);
  });

  it.each(mirrored)("%s: property enums accept every contract value", (name, schema) => {
    const core = unwrap(studio[studioName(name)]) as unknown as {
      def: { type: string; shape?: Record<string, z.ZodType> };
    };
    if (core.def.type !== "object" || !core.def.shape || !schema.properties) return;
    const drift: Record<string, unknown[]> = {};
    for (const [key, property] of Object.entries(schema.properties)) {
      const values = contractEnum(property);
      const field = core.def.shape[key];
      const accepted = field ? enumOptions(field) : null;
      if (values === null || accepted === null) continue;
      const missing = values.filter((value) => !accepted.includes(value));
      if (missing.length > 0) drift[key] = missing;
    }
    expect(drift).toEqual({});
  });
});
