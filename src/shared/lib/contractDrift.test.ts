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
 * - every named error example there (`error_fixtures`, contract 1.72.0+) is read by the
 *   Studio code that handles its code — `current_revision` of a revision conflict, the
 *   sign-up ledger's 403, a publish 409, a policy refusal — or is listed in
 *   `ERROR_READERS` as one Studio deliberately shows only as its message (#701).
 *
 * - every request `builderApi` sends names a method and path the contract declares (#727).
 *
 * A contract form the sampler does not understand is reported, never passed silently.
 * Known drift waits in `KNOWN_DRIFT` with its issue; an entry that stops failing must
 * be removed (ratchet).
 *
 * It also checks that every `PublishIssue.code` in the contract's `x-codes` is one Studio
 * lists in `PUBLISH_ISSUE_CODES`, with a ko and an en message and next step (#644).
 *
 * The contract is read from `BUILDER_CONTRACT` (CI checks out Builder's main). Run
 * locally with `BUILDER_CONTRACT=../kpubdata-builder/contract/builder-api.yaml`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { artifactDownloadRefusal } from "@/features/artifacts/downloadRefusal";
import { revisionErrorOutcome } from "@/features/build-spec/specRevisions";
import { profileRefusal } from "@/features/datasets/profileRefusal";
import { describePublishFailure } from "@/features/publish/api";
import { PUBLISH_ISSUE_CODES } from "@/features/publish/issues";
import { classifyQueryError } from "@/features/sql/api";
import { asInvalidDetails } from "@/features/validation/api";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";
import { builderApi, httpError, PUBLISH_CREDENTIAL_HEADER } from "./builderApi";
import * as schemas from "./builderApi.schema";
import { forgetAllProviderKeys, holdProviderKey, PROVIDER_KEY_HEADER } from "./providerKeys";
import { clearSignupBlock, useSignupStatusStore } from "./signupStatus";
import { contractIssueCodesOf, issueCodeDrift, missingIssueEntries } from "../../../__tests__/support/publishIssueCoverage";

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
  // The contract calls this response ProviderListResponse; Studio reads it with
  // providersResponseSchema, so the name pairing never found it and it went unchecked (#727).
  listProviders: "providersResponseSchema",
  getProviderCredential: {
    schema: "providerCredentialResponseSchema",
    rejectsAdditive: "strict on purpose (#497): an unknown field may be a leaked secret",
  },
  putProviderCredential: { skip: "builderApi does not parse the body; ProviderPage reads nothing from it" },
  deleteProviderCredential: { skip: "builderApi does not parse the body; ProviderPage reads nothing from it" },
};

// --- Error responses (#701) ---

/**
 * One named non-2xx example of the contract (`error_fixtures`, builder#953). An example of
 * an operation's own response names the operation; one of a shared response
 * (`components.responses`, e.g. `SignupNotApproved`) names that response instead.
 */
type ErrorFixture = {
  operation_id?: string;
  response?: string;
  status: number;
  example: string;
  current: unknown;
  with_additive_fields: unknown;
};

/** The contract version whose fixtures file first carries `error_fixtures` (builder#953). */
const ERROR_FIXTURES_SINCE = "1.72.0";

/** `a` compared with `b` as dotted numeric versions: negative, zero or positive. */
function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The error examples of a fixtures file, or why the file is wrong. A file that declares
 * a contract version from before `error_fixtures` may leave it out; a later one must carry
 * a non-empty list, so a contract that dropped it cannot pass on nothing.
 */
function errorFixturesOf(file: { contract_version?: unknown; error_fixtures?: unknown }): {
  fixtures: ErrorFixture[];
  problem: string | null;
} {
  const version = typeof file.contract_version === "string" ? file.contract_version : null;
  if (version === null || !/^\d+(\.\d+)*$/.test(version)) {
    return { fixtures: [], problem: `contract_version ${JSON.stringify(file.contract_version)} is not a version` };
  }
  const required = compareVersions(version, ERROR_FIXTURES_SINCE) >= 0;
  if (file.error_fixtures === undefined) {
    return { fixtures: [], problem: required ? `contract ${version} has no error_fixtures (declared since ${ERROR_FIXTURES_SINCE})` : null };
  }
  if (!Array.isArray(file.error_fixtures)) return { fixtures: [], problem: "error_fixtures is not a list" };
  if (required && file.error_fixtures.length === 0) {
    return { fixtures: [], problem: `contract ${version} has an empty error_fixtures` };
  }
  return { fixtures: file.error_fixtures as ErrorFixture[], problem: null };
}

/** `ERROR_READERS` key of an error example: `<operation or shared response> <status> <example>`. */
const errorFixtureKey = (fixture: ErrorFixture): string =>
  `${fixture.operation_id ?? fixture.response ?? "?"} ${fixture.status} ${fixture.example}`;

/** `label: expected X, got Y` when they differ. */
function differs(label: string, actual: unknown, expected: unknown): string[] {
  return Object.is(actual, expected) ? [] : [`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

/** The sign-up block the request layer records for one error response (#693). */
function signupBlockRecorded(status: number, body: unknown): unknown {
  clearSignupBlock();
  httpError(status, body);
  const { block } = useSignupStatusStore.getState();
  clearSignupBlock();
  return block;
}

/** `describePublishFailure` of one error response, as the publish page and job see it. */
const publishKind = (status: number, body: unknown) => describePublishFailure(httpError(status, body)).kind;

/** A query refusal: `queryErrorResponseSchema` parses it and the SQL workspace reads its code. */
function queryCode(status: number, body: unknown, code: string): string[] {
  const parsed = schemas.queryErrorResponseSchema.safeParse(body);
  return [
    ...(parsed.success ? [] : [`queryErrorResponseSchema: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`]),
    ...differs("classifyQueryError code", classifyQueryError(httpError(status, body)).code, code),
  ];
}

const publishReader = (kind: string): ErrorReader => ({
  reader: "describePublishFailure (features/publish/api)",
  check: (status, body) => differs("kind", publishKind(status, body), kind),
});

type ErrorReader = {
  /** The Studio code that reads the body. */
  reader: string;
  /** What Studio misreads in this body; empty when it reads it as the contract means. */
  check: (status: number, body: unknown) => string[];
};

/**
 * An example Studio shows only as its message. `code` is the code it carries and Studio
 * ignores. `since` is the contract version that introduced the example or gave it that
 * code: Studio's CI reads Builder's main, so an entry for a change Builder has not merged
 * yet must not fail as stale, and one Builder has merged must not fail as unlisted. Before
 * `since` the example may be absent, and when present carries no code (#727).
 */
type NotHandled = { notHandled: string; code?: string; since?: string };

/** The version of the contract under test; null when no contract is given. */
const CONTRACT_VERSION: string | null =
  contractPath && existsSync(contractPath)
    ? String((parse(readFileSync(contractPath, "utf8")) as { info?: { version?: unknown } }).info?.version ?? "")
    : null;

/** Whether the contract under test is older than `since`. Without a contract, nothing is. */
function predates(since: string | undefined, version: string | null = CONTRACT_VERSION): boolean {
  return since !== undefined && version !== null && version !== "" && compareVersions(version, since) < 0;
}

const MESSAGE_ONLY = "shown as its `error` message (httpError → formatApiErrorMessage); Studio reads nothing else from it";

/**
 * Every named error example of the contract, keyed by `errorFixtureKey`: the Studio code
 * that reads it, or why Studio shows it only as its message. An example missing here fails
 * the test, as does an entry the contract no longer has, and a not-handled example that
 * gains a code — Studio must decide whether to read a new code, not meet it unannounced.
 */
const ERROR_READERS: Record<string, ErrorReader | NotHandled> = {
  "validateSpec 400 MissingSources": {
    reader: "asInvalidDetails (features/validation/api)",
    check: (_status, body) =>
      (asInvalidDetails(body)?.problems.length ?? 0) > 0 ? [] : ["asInvalidDetails: no problems read from the body"],
  },
  "validateSpec 400 MalformedYaml": { notHandled: MESSAGE_ONLY },
  "previewBuild 400 InvalidLimit": { notHandled: `${MESSAGE_ONLY}; Studio always sends a valid limit` },
  "createBuild 400 UnsafeRunId": { notHandled: `${MESSAGE_ONLY}; Studio submits through submitBuild` },
  "createBuild 502 ProviderFetchFailed": {
    notHandled: "shown as its message: extractErrorMessage reads `error`, else `outcomes[].error`",
  },
  "listBuildArtifacts 404 RunNotFound": { notHandled: MESSAGE_ONLY },
  "getBuildArtifactFile 403 DeclaredPiiWithheld": {
    reader: "artifactDownloadRefusal (features/artifacts/downloadRefusal, #643)",
    check: (status, body) => {
      const refusal = artifactDownloadRefusal(httpError(status, body));
      return [
        ...differs("refusal code", refusal?.code, "declared_pii_withheld"),
        ...(refusal?.code === "declared_pii_withheld" && refusal.columns.length > 0 ? [] : ["refusal: no columns read"]),
      ];
    },
  },
  "getBuildManifest 404 ManifestNotFound": { notHandled: MESSAGE_ONLY },
  "getBuildSpecSnapshot 404 SnapshotNotFound": { notHandled: `${MESSAGE_ONLY}; the run page treats any 404 as no snapshot` },
  "listBuilds 400 InvalidLimit": { notHandled: `${MESSAGE_ONLY}; Studio always sends a valid limit` },
  "getDataset 404 DatasetNotFound": { notHandled: MESSAGE_ONLY },
  "listDatasetRuns 404 DatasetNotFound": { notHandled: MESSAGE_ONLY },
  "getPublishReadiness 400 UnsupportedTarget": publishReader("invalid_request"),
  "publishBuild 400 InvalidDestination": publishReader("invalid_request"),
  "publishBuild 400 UnknownOption": publishReader("invalid_request"),
  "publishBuild 400 InvalidPublishCredential": publishReader("invalid_publish_credential"),
  // A 409 without a code: readiness changed between the check and the publish. Its
  // `blockers` are not read yet (#677 shows them).
  "publishBuild 409 Blocked": publishReader("readiness_changed"),
  "publishBuild 409 InProgress": publishReader("publish_in_progress"),
  "publishBuild 409 UnknownState": publishReader("publish_state_unknown"),
  "publishBuild 409 Conflict": publishReader("publish_conflict"),
  "publishBuild 502 RemoteFailure": publishReader("publish_failed"),
  "getBuildStageDetail 400 MissingSource": { notHandled: `${MESSAGE_ONLY}; Studio always sends the source` },
  "getDatasetQualityHistory 404 DatasetNotFound": { notHandled: MESSAGE_ONLY },
  "getBuildQuality 404 RunNotFound": { notHandled: MESSAGE_ONLY },
  "queryBuiltDataset 400 UnsafeQuery": { reader: "classifyQueryError (features/sql/api)", check: (status, body) => queryCode(status, body, "unsafe_query") },
  "queryBuiltDataset 400 InvalidContext": { reader: "classifyQueryError (features/sql/api)", check: (status, body) => queryCode(status, body, "invalid_context") },
  "queryBuiltDataset 403 Forbidden": { reader: "classifyQueryError (features/sql/api)", check: (status, body) => queryCode(status, body, "forbidden") },
  "queryBuiltDataset 404 ArtifactUnavailable": { reader: "classifyQueryError (features/sql/api)", check: (status, body) => queryCode(status, body, "artifact_unavailable") },
  "queryBuiltDataset 429 QueryBusy": { reader: "classifyQueryError (features/sql/api)", check: (status, body) => queryCode(status, body, "query_busy") },
  "queryBuiltDataset 504 QueryTimeout": { reader: "classifyQueryError (features/sql/api)", check: (status, body) => queryCode(status, body, "query_timeout") },
  "saveRevision 409 RevisionConflict": {
    reader: "revisionErrorOutcome (features/build-spec/specRevisions, #682)",
    check: (status, body) => revisionConflictProblems(status, body),
  },
  "revertRevision 409 RevisionConflict": {
    reader: "revisionErrorOutcome (features/build-spec/specRevisions, #682)",
    check: (status, body) => revisionConflictProblems(status, body),
  },
  "SignupNotApproved 403 SignupPending": {
    reader: "httpError → noteSignupBlock (shared/lib/signupStatus, #693)",
    check: (status, body) => differs("sign-up block", signupBlockRecorded(status, body), "pending"),
  },
  "SignupNotApproved 403 SignupRejected": {
    reader: "httpError → noteSignupBlock (shared/lib/signupStatus, #693)",
    check: (status, body) => differs("sign-up block", signupBlockRecorded(status, body), "rejected"),
  },
  "Unauthorized 401 MissingOrInvalidApiKey": {
    notHandled: "apiFetch acts on the 401 status (re-authenticates once, #189); the body is only its message",
    code: "unauthorized",
    since: "1.79.0",
  },
  // Stable codes for failures any operation can answer (builder#1000, #994). Studio shows
  // each as its message; acting on the codes (wait and retry, a queue-full notice) is not
  // built yet.
  "submitBuild 429 BuildQueueFull": { notHandled: MESSAGE_ONLY, code: "build_queue_full", since: "1.79.0" },
  "AuthThrottled 429 AuthThrottled": { notHandled: MESSAGE_ONLY, code: "auth_throttled", since: "1.80.0" },
  "ServerOverloaded 503 ServerOverloaded": {
    notHandled: `${MESSAGE_ONLY}; the response is written before the request is read`,
    code: "server_overloaded",
    since: "1.80.0",
  },
  "PiiDeclarationUnavailable 503 PiiDeclarationUnavailable": {
    reader: "artifactDownloadRefusal, profileRefusal and classifyQueryError (#640, #643)",
    check: (status, body) => {
      const download = artifactDownloadRefusal(httpError(status, body));
      const profile = profileRefusal(httpError(status, body));
      return [
        ...differs("download refusal", download?.code === "pii_declaration_unavailable" ? download.dataset !== null : download?.code, true),
        ...differs("profile refusal", profile?.code === "pii_declaration_unavailable" ? profile.dataset !== null : profile?.code, true),
        ...queryCode(status, body, "pii_declaration_unavailable"),
      ];
    },
  },
  "RedistributionForbidden 403 RedistributionForbidden": {
    reader: "artifactDownloadRefusal, profileRefusal and classifyQueryError (#640, #643)",
    check: (status, body) => {
      const download = artifactDownloadRefusal(httpError(status, body));
      const profile = profileRefusal(httpError(status, body));
      return [
        ...differs("download refusal", download?.code === "redistribution_forbidden" ? download.sources.length > 0 : download?.code, true),
        ...differs("profile refusal", profile?.code === "redistribution_forbidden" ? profile.sources.length > 0 : profile?.code, true),
        ...queryCode(status, body, "redistribution_forbidden"),
      ];
    },
  },
};

/** A revision conflict must reach the screen with the revision to reload (#682). */
function revisionConflictProblems(status: number, body: unknown): string[] {
  const outcome = revisionErrorOutcome(httpError(status, body));
  if (outcome.status !== "conflict") return [`outcome: expected "conflict", got ${JSON.stringify(outcome.status)}`];
  return Number.isInteger(outcome.currentRevision) ? [] : ["currentRevision: not read from the body"];
}

/** Error examples `ERROR_READERS` does not list, and listed ones the examples no longer have. */
function errorReaderCoverage(
  fixtures: ErrorFixture[],
  readers: Record<string, unknown> = ERROR_READERS,
  version: string | null = CONTRACT_VERSION,
) {
  const keys = new Set(fixtures.map(errorFixtureKey));
  // An entry for an example a later contract introduces is not stale against an earlier one.
  const awaited = (key: string) => predates((readers[key] as { since?: string } | undefined)?.since, version);
  return {
    unlisted: [...keys].filter((key) => !(key in readers)).sort(),
    stale: Object.keys(readers).filter((key) => !keys.has(key) && !awaited(key)).sort(),
  };
}

/**
 * What Studio misreads in one error example, as sent and with an added field. Every
 * example's message is checked; a read one is also checked by its reader, and a not-handled
 * one must carry no code other than the one its entry names.
 */
function errorFixtureProblems(fixture: ErrorFixture): string[] {
  const entry = ERROR_READERS[errorFixtureKey(fixture)];
  if (!entry) return [`${errorFixtureKey(fixture)}: not in ERROR_READERS`];
  const problems: string[] = [];
  for (const [form, body] of [["current", fixture.current], ["with_additive_fields", fixture.with_additive_fields]] as const) {
    const error = (body as { error?: unknown } | null)?.error;
    if (typeof error === "string") problems.push(...differs(`${form}: message`, httpError(fixture.status, body).message, error));
    if ("notHandled" in entry) {
      const code = (body as { code?: unknown } | null)?.code;
      // Before the version that gave the example its code, it carries none.
      const expected = predates(entry.since) ? undefined : entry.code;
      if (code !== expected) {
        problems.push(`${form}: carries code ${JSON.stringify(code)} that its not-handled entry does not name — read it or list it`);
      }
      continue;
    }
    problems.push(...entry.check(fixture.status, body).map((line) => `${form}: ${line}`));
  }
  clearSignupBlock();
  return problems;
}

/** The contract 1.72.0 examples the checks below rewrite, so they run without a checkout. */
const SAMPLE_ERROR_FIXTURES: ErrorFixture[] = [
  {
    operation_id: "saveRevision",
    status: 409,
    example: "RevisionConflict",
    current: { error: "the document is at revision 2", code: "revision_conflict", current_revision: 2 },
    with_additive_fields: { error: "the document is at revision 2", code: "revision_conflict", current_revision: 2, future_optional_field: "x" },
  },
  {
    response: "SignupNotApproved",
    status: 403,
    example: "SignupPending",
    current: { error: "this account's sign-up is waiting for an administrator's approval", code: "signup_pending" },
    with_additive_fields: { error: "this account's sign-up is waiting for an administrator's approval", code: "signup_pending", future_optional_field: "x" },
  },
  {
    response: "SignupNotApproved",
    status: 403,
    example: "SignupRejected",
    current: { error: "this account's sign-up was rejected", code: "signup_rejected" },
    with_additive_fields: { error: "this account's sign-up was rejected", code: "signup_rejected", future_optional_field: "x" },
  },
  {
    operation_id: "listBuildArtifacts",
    status: 404,
    example: "RunNotFound",
    current: { error: "run not found: missing-run" },
    with_additive_fields: { error: "run not found: missing-run", future_optional_field: "x" },
  },
];

/** `fixture` with `edit` applied to both of its bodies — a contract change, simulated. */
function mutated(fixture: ErrorFixture, edit: (body: Record<string, unknown>) => Record<string, unknown>): ErrorFixture {
  return {
    ...fixture,
    current: edit({ ...(fixture.current as Record<string, unknown>) }),
    with_additive_fields: edit({ ...(fixture.with_additive_fields as Record<string, unknown>) }),
  };
}

/** Rename `from` to `to` in a body, keeping its value. */
const renamed = (from: string, to: string) => (body: Record<string, unknown>) => {
  const { [from]: value, ...rest } = body;
  return { ...rest, [to]: value };
};

/** Replace the body's `code`. */
const recoded = (code: string) => (body: Record<string, unknown>) => ({ ...body, code });

/** The negative checks, against whichever examples they are given (inline or the contract's). */
function errorFixtureNegativeChecks(fixtures: () => ErrorFixture[]) {
  const find = (key: string) => {
    const fixture = fixtures().find((entry) => errorFixtureKey(entry) === key);
    expect(fixture, key).toBeDefined();
    return fixture as ErrorFixture;
  };

  it("reads current_revision from a revision conflict, and fails when the contract renames it", () => {
    const conflict = find("saveRevision 409 RevisionConflict");
    expect(errorFixtureProblems(conflict)).toEqual([]);
    expect(errorFixtureProblems(mutated(conflict, renamed("current_revision", "latest_revision")))).toEqual([
      "current: currentRevision: not read from the body",
      "with_additive_fields: currentRevision: not read from the body",
    ]);
  });

  it.each([
    ["SignupNotApproved 403 SignupPending", "signup_waiting", "pending"],
    ["SignupNotApproved 403 SignupRejected", "signup_denied", "rejected"],
  ])("reads %s as a sign-up block, and fails when the contract renames its code", (key, newCode, block) => {
    const fixture = find(key);
    expect(errorFixtureProblems(fixture)).toEqual([]);
    expect(errorFixtureProblems(mutated(fixture, recoded(newCode)))).toEqual([
      `current: sign-up block: expected "${block}", got null`,
      `with_additive_fields: sign-up block: expected "${block}", got null`,
    ]);
  });

  it("fails when an example Studio shows only as its message gains a code", () => {
    const fixture = mutated(find("listBuildArtifacts 404 RunNotFound"), recoded("run_archived"));
    expect(errorFixtureProblems(fixture)).toEqual([
      'current: carries code "run_archived" that its not-handled entry does not name — read it or list it',
      'with_additive_fields: carries code "run_archived" that its not-handled entry does not name — read it or list it',
    ]);
  });

  it("fails on an error example ERROR_READERS does not list", () => {
    const unknown = { ...find("listBuildArtifacts 404 RunNotFound"), example: "RunArchived", status: 410 };
    expect(errorFixtureProblems(unknown)).toEqual(["listBuildArtifacts 410 RunArchived: not in ERROR_READERS"]);
    expect(errorReaderCoverage([...fixtures(), unknown]).unlisted).toEqual(["listBuildArtifacts 410 RunArchived"]);
  });
}

describe("error fixture checks (#701)", () => {
  // Always runs, on inline 1.72.0 examples: shows each check fails on what it guards.
  errorFixtureNegativeChecks(() => SAMPLE_ERROR_FIXTURES);

  it("requires error_fixtures from the contract version that introduced them", () => {
    expect(errorFixturesOf({ contract_version: "1.71.0" })).toEqual({ fixtures: [], problem: null });
    expect(errorFixturesOf({ contract_version: "1.72.0" }).problem).toBe(
      "contract 1.72.0 has no error_fixtures (declared since 1.72.0)",
    );
    expect(errorFixturesOf({ contract_version: "1.100.0" }).problem).toBe(
      "contract 1.100.0 has no error_fixtures (declared since 1.72.0)",
    );
    expect(errorFixturesOf({ contract_version: "2.0.0", error_fixtures: [] }).problem).toBe(
      "contract 2.0.0 has an empty error_fixtures",
    );
    expect(errorFixturesOf({ contract_version: "1.72.0", error_fixtures: {} }).problem).toBe("error_fixtures is not a list");
    expect(errorFixturesOf({}).problem).toBe("contract_version undefined is not a version");
    expect(errorFixturesOf({ contract_version: "1.72.0", error_fixtures: SAMPLE_ERROR_FIXTURES })).toEqual({
      fixtures: SAMPLE_ERROR_FIXTURES,
      problem: null,
    });
  });

  it("does not call an entry stale before the contract version that introduces its example (#727)", () => {
    const readers = { "later 429 QueueFull": { notHandled: "x", code: "queue_full", since: "9.0.0" } };

    expect(errorReaderCoverage([], readers, "8.9.0").stale).toEqual([]);
    expect(errorReaderCoverage([], readers, "9.0.0").stale).toEqual(["later 429 QueueFull"]);
    expect(predates("9.0.0", "8.9.0")).toBe(true);
    expect(predates("9.0.0", "9.0.0")).toBe(false);
    expect(predates(undefined, "1.0.0")).toBe(false);
  });

  it("reports listed examples the contract no longer has", () => {
    expect(errorReaderCoverage(SAMPLE_ERROR_FIXTURES, { "saveRevision 409 RevisionConflict": {}, "gone 400 Old": {} })).toEqual({
      unlisted: ["SignupNotApproved 403 SignupPending", "SignupNotApproved 403 SignupRejected", "listBuildArtifacts 404 RunNotFound"],
      stale: ["gone 400 Old"],
    });
  });
});

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

  /** Whether the contract declares an operation with this id. */
  const operationExists = (operationId: string): boolean =>
    Object.values(contract.paths ?? {}).some((operations) =>
      (Object.values(operations) as { operationId?: string }[]).some((operation) => operation?.operationId === operationId),
    );

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
      // A skipped operation reads nothing, so its response need not be a named schema;
      // it must still exist in the contract.
      if (typeof mapped !== "string" && "skip" in mapped) return !operationExists(operationId);
      if (operationSchemaName(operationId) === null) return true;
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

  // The publish page describes every blocker code by itself (#644). This file is the
  // one CI runs against Builder's main, so a code Builder adds fails here.
  it("lists every PublishIssue x-code in Studio's PUBLISH_ISSUE_CODES, and no other", () => {
    const codes = contractIssueCodesOf(contract);
    expect(codes.length).toBeGreaterThan(0);
    expect(issueCodeDrift(PUBLISH_ISSUE_CODES, codes)).toEqual([]);
  });

  it("has a ko and an en message and next step for every PublishIssue x-code", () => {
    expect(missingIssueEntries(contractIssueCodesOf(contract), { ko, en })).toEqual([]);
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

    /**
     * The contract's response schema name for a fixture: a plain `$ref`, or the one `$ref`
     * of a `oneOf` whose other members describe nothing (`getBuildArtifactFile`'s
     * `DatasetCard` or any other JSON file, contract 1.75.0).
     */
    const contractSchemaOf = (fixture: Fixture): string | null => {
      const operation = contract.paths?.[fixture.path]?.[fixture.method.toLowerCase()];
      const response = operation?.responses?.[String(fixture.status)];
      const schema = response?.content?.["application/json"]?.schema as { $ref?: string; oneOf?: { $ref?: string }[] } | undefined;
      const refs = schema?.oneOf ? schema.oneOf.flatMap((member) => (member.$ref ? [member.$ref] : [])) : [schema?.$ref];
      const ref = refs.length === 1 ? refs[0] : undefined;
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

  describe("named error examples (contract/fixtures/responses.json error_fixtures, #701)", () => {
    const fixturePath = contractPath ? join(dirname(contractPath), "fixtures", "responses.json") : "";
    const file =
      fixturePath && existsSync(fixturePath)
        ? (JSON.parse(readFileSync(fixturePath, "utf-8")) as { contract_version?: unknown; error_fixtures?: unknown })
        : {};
    const { fixtures: errorFixtures, problem } = errorFixturesOf(file);

    it(`are present when the contract is ${ERROR_FIXTURES_SINCE} or later`, () => {
      expect(problem).toBeNull();
    });

    it("are each read by Studio or listed as not handled, and every listed one exists", () => {
      // Before 1.72.0 the file has none; there is nothing to compare ERROR_READERS with.
      if (errorFixtures.length === 0) return;
      const { unlisted, stale } = errorReaderCoverage(errorFixtures);
      expect(unlisted, "error examples Studio neither reads nor lists as not handled — add them to ERROR_READERS").toEqual([]);
      expect(stale, "listed in ERROR_READERS but no longer in the contract — remove them").toEqual([]);
    });

    it.each(errorFixtures.map((fixture) => [errorFixtureKey(fixture), fixture] as const))(
      "%s: Studio reads it as the contract means, as sent and with an added field",
      (_label, fixture) => {
        expect(errorFixtureProblems(fixture)).toEqual([]);
      },
    );

    // The contract's own examples, rewritten the way a breaking rename would.
    describe.skipIf(errorFixtures.length === 0)("rewritten", () => {
      errorFixtureNegativeChecks(() => errorFixtures);
    });
  });
});

// --- Routes (#727) ---
//
// The checks above compare response bodies; nothing asserted that the routes the client
// calls exist. Each `builderApi` function is called with placeholder arguments against a
// stubbed `fetch`, the method and path it sends are recorded, and the pair must match a
// contract operation — a path parameter matches any single segment. It lives in this
// file because this is the file CI runs with `BUILDER_CONTRACT` set.

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

/** `METHOD /path/{param}` of every contract operation, as a matcher on a concrete path. */
function contractRoutes(): Array<{ method: string; template: string; pattern: RegExp }> {
  const doc = parse(readFileSync(contractPath as string, "utf8")) as { paths: Record<string, Record<string, unknown>> };
  return Object.entries(doc.paths).flatMap(([template, item]) =>
    METHODS.filter((method) => method in item).map((method) => ({
      method: method.toUpperCase(),
      template,
      pattern: new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`),
    })),
  );
}

type SentRequest = { method: string; path: string; headers: Record<string, string> };

/** What a client function sends when called with placeholder arguments. */
async function requestOf(name: string): Promise<SentRequest | null> {
  let sent: SentRequest | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent ??= {
        method: init?.method ?? "GET",
        path: new URL(url).pathname,
        headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
      };
      // Not retried (4xx), so each function is called once.
      return { ok: false, status: 418, headers: new Headers(), text: async () => "{}" } as unknown as Response;
    }),
  );
  const call = builderApi[name as keyof typeof builderApi] as (...args: unknown[]) => Promise<unknown>;
  // Placeholders: a path segment where a string is expected, and an object that answers
  // any property with a segment for the functions that take a request object. Fewer
  // arguments are tried first, so a placeholder never lands on a trailing `signal`.
  const anything = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? "x" : undefined) });
  const attempts: unknown[][] = [
    [],
    ["x"],
    [anything],
    ["x", "x"],
    ["x", anything],
    ["x", "x", "x"],
    ["x", "x", anything],
    ["x", anything, anything],
  ];
  for (const args of attempts) {
    try {
      await call(...args);
    } catch {
      // An ApiError for the stubbed 418, or a function that rejects these arguments.
    }
    if (sent !== null) break;
  }
  return sent;
}

/** The contract version that declares `X-Provider-Key` as a parameter (builder#994). */
const PROVIDER_KEY_PARAMETER_SINCE = "1.80.0";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.skipIf(!contractPath)("builderApi routes against Builder's contract (#727)", () => {
  it("every client function sends a method and path the contract declares", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const routes = contractRoutes();
    const unsent: string[] = [];
    const undeclared: string[] = [];

    for (const name of Object.keys(builderApi)) {
      const request = await requestOf(name);
      if (request === null) {
        unsent.push(name);
        continue;
      }
      if (!routes.some((route) => route.method === request.method && route.pattern.test(request.path))) {
        undeclared.push(`${name}: ${request.method} ${request.path}`);
      }
    }

    // A function this probe cannot make send a request is not checked — it has to be
    // listed, so a new one is noticed rather than silently skipped.
    expect(unsent).toEqual(UNPROBED);
    expect(undeclared).toEqual([]);
  });

  it(`declares X-Provider-Key on every operation Studio sends it to, from contract ${PROVIDER_KEY_PARAMETER_SINCE} (#727)`, async () => {
    type Parameter = { $ref?: string; name?: string; in?: string };
    const doc = parse(readFileSync(contractPath as string, "utf8")) as {
      info: { version: string };
      paths: Record<string, Record<string, { operationId?: string; parameters?: Parameter[] }>>;
      components: { parameters?: Record<string, Parameter> };
    };
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    expect(holdProviderKey("datago", "placeholder-provider-key")).toBe(true);
    const routes = contractRoutes();
    const sending: string[] = [];
    const undeclared: string[] = [];
    try {
      for (const name of Object.keys(builderApi)) {
        const request = await requestOf(name);
        if (request === null || !(PROVIDER_KEY_HEADER in request.headers)) continue;
        sending.push(name);
        const route = routes.find((candidate) => candidate.method === request.method && candidate.pattern.test(request.path));
        const declared = (doc.paths[route?.template ?? ""]?.[request.method.toLowerCase()]?.parameters ?? [])
          .map((parameter) => (parameter.$ref ? doc.components.parameters?.[parameter.$ref.split("/").pop() ?? ""] : parameter))
          .some((parameter) => parameter?.in === "header" && parameter.name === PROVIDER_KEY_HEADER);
        if (!declared) undeclared.push(`${name}: ${request.method} ${route?.template ?? request.path}`);
      }
    } finally {
      forgetAllProviderKeys();
    }

    // The probe must find the calls that carry the key, or the check proves nothing.
    expect(sending.sort()).toEqual(["build", "getProviderStatus", "preview", "submitBuild", "testProviderConnection"].sort());
    // An earlier contract mentions the header only in prose; from the version that
    // declares it, every operation Studio sends it to has to carry the parameter.
    if (compareVersions(doc.info.version, PROVIDER_KEY_PARAMETER_SINCE) >= 0) expect(undeclared).toEqual([]);
  });

  it("fails on a route the contract does not declare", () => {
    const routes = contractRoutes();
    const declared = (method: string, path: string) =>
      routes.some((route) => route.method === method && route.pattern.test(path));

    expect(declared("GET", "/builds/run-1/manifest")).toBe(true);
    expect(declared("DELETE", "/builds/run-1/manifest")).toBe(false);
    expect(declared("GET", "/no/such/route")).toBe(false);
    // A parameter matches one segment, not several.
    expect(declared("GET", "/builds/run-1/extra/manifest")).toBe(false);
  });
});

/** Client functions the placeholder call cannot drive to a request, each with its reason. */
const UNPROBED: string[] = [];
