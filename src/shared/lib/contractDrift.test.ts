/**
 * Studio's response schemas against Builder's contract (kpubdata-builder#693, #607).
 *
 * Studio validates every Builder response with the hand-written Zod schemas in
 * builderApi.schema.ts. When Builder adds an enum value Studio has not listed, every
 * response carrying it fails to parse — `run_cancelled` did exactly that from
 * builder#481 until Studio #473. Nothing compared the two.
 *
 * For each contract schema that Studio mirrors by name (`BuildEventName` →
 * `buildEventNameSchema`), this checks:
 *
 * - a contract enum value Studio's enum does not accept;
 * - a key Studio requires that the contract does not define;
 * - a contract-valid response Studio rejects (#607). Every response schema is expanded
 *   into sample bodies — the minimal one (required fields only) and one variation per
 *   optional field, nullable, union branch, enum value and array item, at every depth
 *   through `$ref`, `oneOf`/`anyOf`/`allOf` — and each must parse. This is what catches
 *   a field Studio requires but the contract leaves optional, a nested object Studio
 *   types narrower than the contract (`BuildJob.response`, #603), or a missing `null`.
 * - every named response example in the contract's `fixtures/responses.json`, as sent
 *   and with an unknown field added, parses with the schema Studio reads it with.
 *
 * A contract form the sampler does not understand is reported, never passed silently.
 * Known drift waits in `KNOWN_DRIFT` with its issue; an entry that stops failing must
 * be removed (ratchet).
 *
 * The contract is read from `BUILDER_CONTRACT` (CI checks out Builder's main). Run
 * locally with `BUILDER_CONTRACT=../kpubdata-builder/contract/builder-api.yaml`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { PUBLISH_CREDENTIAL_HEADER } from "./builderApi";
import * as schemas from "./builderApi.schema";

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  required?: string[];
  $ref?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  nullable?: boolean;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  example?: unknown;
  examples?: unknown[];
  [keyword: string]: unknown;
};

type Contract = {
  paths?: Record<string, Record<string, { responses?: Record<string, ResponseObject> }>>;
  components: { schemas: Record<string, JsonSchema>; responses?: Record<string, ResponseObject> };
};

type ResponseObject = { $ref?: string; content?: Record<string, { schema?: JsonSchema }> };

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

// --- Contract-valid sample bodies (#607) ---

/** Keywords the sampler understands. Anything else is reported as unsupported. */
const KNOWN_KEYWORDS = new Set([
  "type", "enum", "const", "properties", "additionalProperties", "items", "required", "$ref",
  "oneOf", "anyOf", "allOf", "not", "nullable", "format", "pattern", "minimum", "maximum",
  "minLength", "maxLength", "minItems", "maxItems", "example", "examples", "default",
  "description", "title", "readOnly", "writeOnly", "deprecated",
]);

/** A value for each `pattern` the contract uses on a response string with no example. */
const PATTERN_SAMPLES: Record<string, string> = {
  "^upl_[a-f0-9]{32}$": `upl_${"0".repeat(32)}`,
  "^sha256:[0-9a-f]{64}$": `sha256:${"0".repeat(64)}`,
  "^[a-z0-9][a-z0-9_-]{0,63}$": "datago",
  "^P(?:\\d+W|\\d+D|T\\d+H|\\d+DT\\d+H)$": "P1D",
};

const FORMAT_SAMPLES: Record<string, string> = {
  "date-time": "2026-08-16T09:00:00+00:00",
  date: "2026-08-16",
  uri: "https://example.org/data",
};

/** Values an untyped schema (`{}`, description only) allows. */
const ANY_SAMPLES: unknown[] = ["x", 0, true, null, {}, []];

type Sample = { label: string; value: unknown };

/**
 * Expands a contract schema into contract-valid sample bodies. The first sample is the
 * minimal one; every other differs from it in one place, named by its label.
 */
class ContractSampler {
  readonly unsupported: string[] = [];

  constructor(private readonly components: Record<string, JsonSchema>) {}

  samples(schema: JsonSchema, path = "$"): Sample[] {
    return this.expand(schema, path, []);
  }

  private report(path: string, what: string): void {
    const line = `${path}: ${what}`;
    if (!this.unsupported.includes(line)) this.unsupported.push(line);
  }

  private resolve(ref: string, path: string): [string, JsonSchema] | null {
    const prefix = "#/components/schemas/";
    const name = ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
    const target = name === null ? undefined : this.components[name];
    if (name === null || !target) {
      this.report(path, `unresolved $ref ${ref}`);
      return null;
    }
    return [name, target];
  }

  /** Flatten `$ref`/`allOf`/`oneOf`/`anyOf` into alternative plain schemas. */
  private flatten(schema: JsonSchema, path: string, stack: string[]): { schema: JsonSchema; stack: string[] }[] {
    for (const keyword of Object.keys(schema)) {
      if (!KNOWN_KEYWORDS.has(keyword) && !keyword.startsWith("x-")) {
        this.report(path, `keyword "${keyword}"`);
      }
    }
    if (schema.$ref) {
      const resolved = this.resolve(schema.$ref, path);
      if (!resolved) return [];
      const [name, target] = resolved;
      // A recursive schema (JsonValue) is expanded once; deeper it keeps its minimal form.
      if (stack.filter((entry) => entry === name).length >= 2) return [];
      const { $ref: _ref, ...siblings } = schema;
      return this.flatten(merge(target, siblings), path, [...stack, name]);
    }
    if (schema.not) {
      const keys = Object.keys(schema.not);
      // `not: {required: [...]}` forbids keys; samples only ever add declared properties.
      if (keys.length !== 1 || keys[0] !== "required") this.report(path, "`not` other than `not: {required}`");
    }
    if (schema.allOf) {
      const { allOf, ...rest } = schema;
      let alternatives = [{ schema: rest as JsonSchema, stack }];
      for (const part of allOf) {
        if (part.not && Object.keys(part).length === 1) {
          this.flatten(part, path, stack);
          continue;
        }
        const partAlternatives = this.flatten(part, path, stack);
        alternatives = alternatives.flatMap((left) =>
          partAlternatives.map((right) => ({ schema: merge(left.schema, right.schema), stack: right.stack })),
        );
      }
      return alternatives.flatMap((entry) => this.flatten(entry.schema, path, entry.stack));
    }
    const branches = schema.oneOf ?? schema.anyOf;
    if (branches) {
      const { oneOf: _oneOf, anyOf: _anyOf, ...rest } = schema;
      return branches.flatMap((branch) => this.flatten(merge(rest, branch), path, stack));
    }
    return [{ schema, stack }];
  }

  private expand(schema: JsonSchema, path: string, stack: string[]): Sample[] {
    const alternatives = this.flatten(schema, path, stack);
    const out: Sample[] = [];
    for (const [index, entry] of alternatives.entries()) {
      const branch = this.expandPlain(entry.schema, path, entry.stack);
      // A later branch's minimal body is named by its branch; its other samples by their value.
      const minimal = `${path} = minimal`;
      out.push(...branch.map((sample) => (index > 0 && sample.label === minimal ? { ...sample, label: `${minimal} (branch ${index})` } : sample)));
    }
    return out;
  }

  private expandPlain(schema: JsonSchema, path: string, stack: string[]): Sample[] {
    const leaf = (value: unknown): Sample => ({ label: `${path} = ${JSON.stringify(value)}`, value });
    if ("const" in schema) return [leaf(schema.const)];
    if (schema.enum) return schema.enum.map(leaf);

    let types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length === 0) {
      if (schema.properties || schema.additionalProperties !== undefined || schema.required) types = ["object"];
      else if (schema.items) types = ["array"];
    }
    if (schema.nullable === true && !types.includes("null")) types = [...types, "null"];
    if (types.length === 0) return ANY_SAMPLES.map(leaf);

    const out: Sample[] = [];
    for (const type of types) {
      switch (type) {
        case "null":
          out.push(leaf(null));
          break;
        case "boolean":
          out.push(leaf(false), leaf(true));
          break;
        case "integer":
        case "number": {
          const value = schema.minimum ?? (schema.maximum !== undefined && schema.maximum < 0 ? schema.maximum : 0);
          out.push(leaf(value));
          break;
        }
        case "string": {
          const value = this.stringSample(schema, path);
          if (value !== null) out.push(leaf(value));
          break;
        }
        case "array":
          out.push(...this.arraySamples(schema, path, stack));
          break;
        case "object":
          out.push(...this.objectSamples(schema, path, stack));
          break;
        default:
          this.report(path, `type "${type}"`);
      }
    }
    return out;
  }

  private stringSample(schema: JsonSchema, path: string): string | null {
    const fits = (value: unknown): value is string =>
      typeof value === "string" && (!schema.pattern || new RegExp(schema.pattern).test(value));
    for (const candidate of [schema.example, ...(schema.examples ?? []), schema.default]) {
      if (fits(candidate)) return candidate;
    }
    if (schema.pattern) {
      const value = PATTERN_SAMPLES[schema.pattern];
      if (fits(value)) return value;
      this.report(path, `pattern ${schema.pattern} without an example (add it to PATTERN_SAMPLES)`);
      return null;
    }
    if (schema.format) {
      const value = FORMAT_SAMPLES[schema.format];
      if (value !== undefined) return value;
      this.report(path, `format "${schema.format}"`);
      return null;
    }
    const length = Math.min(Math.max(schema.minLength ?? 1, 1), schema.maxLength ?? Infinity);
    return "x".repeat(length);
  }

  private arraySamples(schema: JsonSchema, path: string, stack: string[]): Sample[] {
    const items = schema.items ? this.expand(schema.items, `${path}[]`, stack) : ANY_SAMPLES.map((value) => ({ label: `${path}[] = ${JSON.stringify(value)}`, value }));
    const count = schema.minItems ?? 0;
    const base = items[0];
    if (!base) return [];
    const minimal: Sample = { label: `${path} = minimal`, value: Array.from({ length: count }, () => base.value) };
    const variants = items
      .filter((_, index) => count === 0 || index > 0)
      .map((item) => ({
        label: item.label,
        value: [item.value, ...Array.from({ length: Math.max(count - 1, 0) }, () => base.value)],
      }));
    return [minimal, ...variants];
  }

  private objectSamples(schema: JsonSchema, path: string, stack: string[]): Sample[] {
    const forbidden = new Set(schema.not?.required ?? []);
    const properties = Object.entries(schema.properties ?? {}).filter(([key]) => !forbidden.has(key));
    const required = new Set(schema.required ?? []);
    const expanded = new Map(properties.map(([key, property]) => [key, this.expand(property, `${path}.${key}`, stack)]));
    const base: Record<string, unknown> = {};
    for (const key of required) {
      const samples = expanded.get(key);
      if (!samples) {
        // Required but undeclared: any value is contract-valid.
        base[key] = ANY_SAMPLES[0];
        continue;
      }
      if (!samples[0]) return [];
      base[key] = samples[0].value;
    }
    const out: Sample[] = [{ label: `${path} = minimal`, value: base }];
    for (const [key, samples] of expanded) {
      for (const sample of required.has(key) ? samples.slice(1) : samples) {
        out.push({ label: sample.label, value: { ...base, [key]: sample.value } });
      }
    }
    if (typeof schema.additionalProperties === "object" && properties.length === 0) {
      for (const sample of this.expand(schema.additionalProperties, `${path}.*`, stack)) {
        out.push({ label: sample.label, value: { ...base, key: sample.value } });
      }
    }
    return out;
  }
}

/** Merge two schemas the way `allOf` (or a `oneOf` branch with its parent) combines them. */
function merge(left: JsonSchema, right: JsonSchema): JsonSchema {
  const merged: JsonSchema = { ...left, ...right };
  if (left.properties || right.properties) merged.properties = { ...left.properties, ...right.properties };
  if (left.required || right.required) merged.required = [...new Set([...(left.required ?? []), ...(right.required ?? [])])];
  if (left.type !== undefined && right.type !== undefined) {
    const leftTypes = [left.type].flat();
    const rightTypes = new Set([right.type].flat());
    const common = leftTypes.filter((type) => rightTypes.has(type));
    merged.type = common.length === 1 ? common[0] : common;
  }
  return merged;
}

/**
 * Every contract-valid sample of `contractSchema` that `studioSchema` rejects, as
 * `label → issue` lines, plus the contract forms the sampler could not read.
 */
function responseDrift(
  contractSchema: JsonSchema,
  studioSchema: z.ZodType,
  components: Record<string, JsonSchema>,
): { rejected: string[]; unsupported: string[] } {
  const sampler = new ContractSampler(components);
  const rejected = new Set<string>();
  const samples = sampler.samples(contractSchema);
  if (samples.length === 0) sampler.unsupported.push("$: no contract-valid sample");
  for (const sample of samples) {
    const result = studioSchema.safeParse(sample.value);
    if (result.success) continue;
    const issue = result.error.issues[0];
    rejected.add(`${sample.label} → ${issue?.path.join(".") || "$"}: ${issue?.message ?? "rejected"}`);
  }
  return { rejected: [...rejected].sort(), unsupported: sampler.unsupported };
}

/** Component schema names reachable from any 2xx JSON response of the contract. */
function responseSchemaNames(contract: Contract): Set<string> {
  const reached = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const ref = (node as { $ref?: unknown }).$ref;
    if (typeof ref === "string" && ref.startsWith("#/components/schemas/")) {
      const name = ref.slice("#/components/schemas/".length);
      if (reached.has(name)) return;
      reached.add(name);
      visit(contract.components.schemas[name]);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== "example" && key !== "examples") visit(value);
    }
  };
  for (const operations of Object.values(contract.paths ?? {})) {
    for (const operation of Object.values(operations)) {
      for (const [status, response] of Object.entries(operation?.responses ?? {})) {
        if (!status.startsWith("2")) continue;
        const resolved = response.$ref
          ? contract.components.responses?.[response.$ref.split("/").pop() ?? ""]
          : response;
        visit(resolved?.content?.["application/json"]?.schema);
      }
    }
  }
  return reached;
}

/**
 * Known contract-valid responses Studio still rejects, keyed by
 * `SchemaName: sample label → issue`. Each names the issue that fixes it. The test fails
 * when a new one appears and when a listed one no longer fails.
 */
const KNOWN_DRIFT: Record<string, string> = {};

type SchemaName = keyof typeof schemas;

/**
 * Operations whose response Studio does not parse with a schema named after the
 * contract's, mapped to the Studio schema `builderApi` reads it with — or to why none
 * does. Mapped operations get the same sample check as mirrored schemas.
 */
const OPERATION_SCHEMAS: Record<string, SchemaName | { schema: SchemaName; rejectsAdditive: string } | { skip: string }> = {
  createBuild: "buildResponseSchema",
  getBuildManifest: "buildManifestResponseSchema",
  getProviderCredential: {
    schema: "providerCredentialResponseSchema",
    rejectsAdditive: "strict on purpose (#497): an unknown field may be a leaked secret",
  },
  putProviderCredential: { skip: "builderApi does not parse the body; ProviderPage reads nothing from it" },
  deleteProviderCredential: { skip: "builderApi does not parse the body; ProviderPage reads nothing from it" },
};

describe("contract response sampler", () => {
  // Always runs: shows the check itself fails on a Studio schema stricter than the contract.
  const components: Record<string, JsonSchema> = {
    Item: {
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" }, b: { type: ["string", "null"] } },
    },
    Job: {
      type: "object",
      required: ["id", "state"],
      properties: {
        id: { type: "string" },
        state: { type: "string", enum: ["queued", "failed"] },
        response: { type: ["object", "null"] },
        items: { type: "array", items: { $ref: "#/components/schemas/Item" } },
        kind: { oneOf: [{ type: "integer", minimum: 1 }, { type: "string", enum: ["auto"] }] },
      },
    },
  };
  const item = z.object({ a: z.string(), b: z.string().nullable().optional() });
  const lenient = z.object({
    id: z.string(),
    state: z.enum(["queued", "failed"]),
    response: z.record(z.string(), z.unknown()).nullable().optional(),
    items: z.array(item).optional(),
    kind: z.union([z.number().int(), z.literal("auto")]).optional(),
  });
  const drift = (schema: z.ZodType) => responseDrift(components.Job, schema, components);

  it("passes a Studio schema that accepts every contract-valid body", () => {
    expect(drift(lenient)).toEqual({ rejected: [], unsupported: [] });
  });

  it("does not fail on an unknown additive field or a field Studio does not model", () => {
    const narrow = z.object({ id: z.string(), state: z.enum(["queued", "failed"]) });
    expect(drift(narrow).rejected).toEqual([]);
    expect(narrow.safeParse({ id: "x", state: "queued", future_optional_field: 1 }).success).toBe(true);
  });

  it("fails when a nested object is typed narrower than the contract (#603)", () => {
    const stricter = lenient.extend({
      response: z.object({ status: z.literal("ok"), outcomes: z.array(z.unknown()) }).nullable().optional(),
    });
    expect(drift(stricter).rejected).toEqual([
      '$.response = minimal → response.status: Invalid input: expected "ok"',
    ]);
  });

  it("fails when Studio requires a field the contract leaves optional, at any depth", () => {
    expect(drift(lenient.extend({ response: z.record(z.string(), z.unknown()).nullable() })).rejected).toContain(
      "$ = minimal → response: Invalid input: expected record, received undefined",
    );
    const nested = lenient.extend({ items: z.array(item.extend({ b: z.string().nullable() })).optional() });
    expect(drift(nested).rejected).toEqual([
      "$.items[] = minimal → items.0.b: Invalid input: expected string, received undefined",
    ]);
  });

  it("fails on a missing null, enum value or union branch", () => {
    const notNullable = lenient.extend({ items: z.array(item.extend({ b: z.string().optional() })).optional() });
    expect(drift(notNullable).rejected).toEqual([
      "$.items[].b = null → items.0.b: Invalid input: expected string, received null",
    ]);
    expect(drift(lenient.extend({ state: z.enum(["queued"]) })).rejected).toEqual([
      '$.state = "failed" → state: Invalid input: expected "queued"',
    ]);
    expect(drift(lenient.extend({ kind: z.number().int().optional() })).rejected).toEqual([
      '$.kind = "auto" → kind: Invalid input: expected number, received string',
    ]);
  });

  it("reports a contract form it cannot read instead of passing it", () => {
    const odd = { type: "object", properties: { a: { type: "string", format: "ipv6" }, b: { if: {} } } } as JsonSchema;
    expect(responseDrift(odd, z.object({}), {}).unsupported).toEqual([
      '$.a: format "ipv6"',
      '$.b: keyword "if"',
    ]);
    expect(responseDrift({ $ref: "#/components/schemas/Missing" }, z.unknown(), {}).unsupported).toEqual([
      "$: unresolved $ref #/components/schemas/Missing",
      "$: no contract-valid sample",
    ]);
  });
});

describe("BuildJob against the contract's BuildJob (#603)", () => {
  // The contract's BuildJob as of 1.64.0, kept here so this runs without a checkout.
  const contractBuildJob: JsonSchema = {
    type: "object",
    required: ["run_id", "status", "created_at", "updated_at"],
    properties: {
      run_id: { type: "string" },
      status: { type: "string", enum: ["queued", "running", "cancelling", "succeeded", "failed", "cancelled"] },
      created_at: { type: "string" },
      updated_at: { type: "string" },
      created_by: { type: ["string", "null"] },
      response: { type: ["object", "null"] },
      error: { type: ["string", "null"] },
    },
  };
  const preFix = schemas.buildJobSchema.extend({ response: schemas.buildResponseSchema.nullable().optional() });

  it("the schema before #603 is caught", () => {
    expect(responseDrift(contractBuildJob, preFix, {}).rejected).not.toEqual([]);
  });

  it("the current schema accepts every contract-valid job", () => {
    expect(responseDrift(contractBuildJob, schemas.buildJobSchema, {})).toEqual({ rejected: [], unsupported: [] });
  });
});

describe.skipIf(!contractPath)("Builder contract drift", () => {
  const contract: Contract = contractPath
    ? (parse(readFileSync(contractPath, "utf-8")) as Contract)
    : { components: { schemas: {} } };
  const components = contract.components.schemas;
  const mirrored = Object.entries(components).filter(([name]) => studioName(name) in schemas);
  const studio = schemas as unknown as Record<string, z.ZodType>;
  const responseNames = responseSchemaNames(contract);

  /** The contract's `$ref` response schema name for an operation's 2xx response. */
  const operationSchemaName = (operationId: string): string | null => {
    for (const operations of Object.values(contract.paths ?? {})) {
      for (const operation of Object.values(operations) as { operationId?: string; responses?: Record<string, ResponseObject> }[]) {
        if (operation?.operationId !== operationId) continue;
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          const ref = response.content?.["application/json"]?.schema?.$ref;
          if (status.startsWith("2") && ref?.startsWith("#/components/schemas/")) return ref.slice("#/components/schemas/".length);
        }
      }
    }
    return null;
  };

  /** Response schemas checked with samples: mirrored by name, plus OPERATION_SCHEMAS. */
  const responsePairs: [string, JsonSchema, z.ZodType][] = mirrored
    .filter(([name]) => responseNames.has(name))
    .map(([name, schema]) => [name, schema, studio[studioName(name)]]);
  for (const [operationId, mapped] of Object.entries(OPERATION_SCHEMAS)) {
    if (typeof mapped !== "string" && "skip" in mapped) continue;
    const contractName = operationSchemaName(operationId);
    if (!contractName || responsePairs.some(([name]) => name === contractName)) continue;
    const schemaName = typeof mapped === "string" ? mapped : mapped.schema;
    responsePairs.push([contractName, components[contractName], studio[schemaName]]);
  }

  it("maps every OPERATION_SCHEMAS entry to a contract operation and a Studio schema", () => {
    const broken = Object.entries(OPERATION_SCHEMAS).filter(([operationId, mapped]) => {
      if (operationSchemaName(operationId) === null) return true;
      if (typeof mapped !== "string" && "skip" in mapped) return false;
      return !((typeof mapped === "string" ? mapped : mapped.schema) in schemas);
    });
    expect(broken.map(([operationId]) => operationId)).toEqual([]);
  });

  it("mirrors a meaningful part of the contract by name", () => {
    // If a rename made nothing match, the checks below would pass on nothing.
    expect(mirrored.length).toBeGreaterThan(30);
    expect(responsePairs.length).toBeGreaterThan(30);
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

  it.each(responsePairs)("%s: accepts every contract-valid response", (name, schema, studioSchema) => {
    const { rejected, unsupported } = responseDrift(schema, studioSchema, components);
    expect(unsupported).toEqual([]);
    const unexpected = rejected.filter((line) => !(`${name}: ${line}` in KNOWN_DRIFT));
    expect(unexpected).toEqual([]);
    const stale = Object.keys(KNOWN_DRIFT).filter(
      (key) => key.startsWith(`${name}: `) && !rejected.includes(key.slice(name.length + 2)),
    );
    expect(stale, "listed in KNOWN_DRIFT but no longer failing — remove it").toEqual([]);
  });

  it("declares the X-Publish-Credential header Studio sends on readiness and publish (#615)", () => {
    type Parameter = { $ref?: string; name?: string; in?: string };
    const raw = contract as unknown as {
      paths: Record<string, Record<string, { operationId?: string; parameters?: Parameter[] }>>;
      components: { parameters?: Record<string, Parameter> };
    };
    const headersOf = (operationId: string): string[] => {
      for (const operations of Object.values(raw.paths)) {
        for (const operation of Object.values(operations)) {
          if (operation?.operationId !== operationId) continue;
          return (operation.parameters ?? [])
            .map((p) => (p.$ref ? raw.components.parameters?.[p.$ref.split("/").pop() ?? ""] : p))
            .filter((p): p is Parameter => p?.in === "header")
            .map((p) => p.name ?? "");
        }
      }
      return [];
    };
    expect(headersOf("getPublishReadiness")).toContain(PUBLISH_CREDENTIAL_HEADER);
    expect(headersOf("publishBuild")).toContain(PUBLISH_CREDENTIAL_HEADER);
  });

  it("lists no KNOWN_DRIFT entry for a schema this check does not cover", () => {
    const covered = new Set(responsePairs.map(([name]) => name));
    expect(Object.keys(KNOWN_DRIFT).filter((key) => !covered.has(key.split(": ")[0]))).toEqual([]);
  });

  describe("named response examples (contract/fixtures/responses.json)", () => {
    const fixturePath = contractPath ? join(dirname(contractPath), "fixtures", "responses.json") : "";
    type Fixture = {
      operation_id: string;
      method: string;
      path: string;
      status: number;
      example: string;
      current: unknown;
      with_additive_fields: unknown;
    };
    const fixtures: Fixture[] =
      fixturePath && existsSync(fixturePath)
        ? (JSON.parse(readFileSync(fixturePath, "utf-8")) as { fixtures: Fixture[] }).fixtures
        : [];

    it("are present next to the contract", () => {
      expect(existsSync(fixturePath), fixturePath).toBe(true);
      expect(fixtures.length).toBeGreaterThan(0);
    });

    /** The contract's response schema name for a fixture, when it is a plain `$ref`. */
    const contractSchemaOf = (fixture: Fixture): string | null => {
      const operation = contract.paths?.[fixture.path]?.[fixture.method.toLowerCase()];
      const response = operation?.responses?.[String(fixture.status)];
      const ref = response?.content?.["application/json"]?.schema?.$ref;
      return ref?.startsWith("#/components/schemas/") ? ref.slice("#/components/schemas/".length) : null;
    };

    const studioSchemaOf = (
      fixture: Fixture,
    ): { schema: z.ZodType; rejectsAdditive?: string } | { skip: string } | null => {
      const mapped = OPERATION_SCHEMAS[fixture.operation_id];
      if (typeof mapped === "string") return { schema: studio[mapped] };
      if (mapped && "skip" in mapped) return mapped;
      if (mapped) return { schema: studio[mapped.schema], rejectsAdditive: mapped.rejectsAdditive };
      const name = contractSchemaOf(fixture);
      return name && studioName(name) in schemas ? { schema: studio[studioName(name)] } : null;
    };

    it.each(fixtures.map((fixture) => [`${fixture.operation_id}/${fixture.example}`, fixture] as const))(
      "%s: parses as sent and with an added field",
      (_label, fixture) => {
        const mapped = studioSchemaOf(fixture);
        expect(mapped, `no Studio schema for ${fixture.operation_id}; map it in OPERATION_SCHEMAS`).not.toBeNull();
        if (!mapped || "skip" in mapped) return;
        const issues = (value: unknown) => {
          const result = mapped.schema.safeParse(value);
          return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
        };
        expect(issues(fixture.current)).toEqual([]);
        if (mapped.rejectsAdditive) {
          // Documented exception: it must still reject, or the exception is stale.
          expect(issues(fixture.with_additive_fields), mapped.rejectsAdditive).not.toEqual([]);
        } else {
          expect(issues(fixture.with_additive_fields)).toEqual([]);
        }
      },
    );
  });
});
