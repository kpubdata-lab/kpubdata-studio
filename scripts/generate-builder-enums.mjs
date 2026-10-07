#!/usr/bin/env node
/**
 * Write the enums of Builder's contract into Studio (#793).
 *
 * Studio validates Builder's responses with schemas written by hand, and each enum in
 * them was typed out again from `contract/builder-api.yaml`. This reads the contract and
 * writes every enum of its `components.schemas` into
 * `src/shared/lib/generated/builderEnums.ts`, a file nobody edits. The hand-written
 * schemas take their enums from there (`builderEnum("BuildJob.status")`).
 *
 * The file records the contract version it was generated from. That is what lets Studio
 * go first, as it must: Builder cannot merge an enum value Studio's drift test does not
 * accept, so the value is generated here from Builder's branch before that branch
 * merges, and Studio then holds a snapshot of a contract newer than Builder's `main`.
 * `builderEnums.test.ts` asks for an exact match only when the contract it is given is
 * the version the snapshot names; at any other version the existing drift test's rule
 * holds, as before — every value the contract allows must be accepted.
 *
 * An enum is named by where it is: `Schema` for a schema that is itself an enum, and
 * `Schema.property[.property…]` for one inside it. `properties`, `items` and the
 * `allOf` / `oneOf` / `anyOf` positions are left out of the name; when two enums with
 * different values would then share a name, generation fails rather than pick one.
 *
 * Usage:
 *   node scripts/generate-builder-enums.mjs [--contract ../kpubdata-builder/contract/builder-api.yaml]
 *   node scripts/generate-builder-enums.mjs --check     # exit 1 when the file is stale
 *
 * The contract is `--contract`, else `$BUILDER_CONTRACT`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT = join(ROOT, "src", "shared", "lib", "generated", "builderEnums.ts");

/** Keys of a schema object that hold sub-schemas without adding to an enum's name. */
const TRANSPARENT = new Set(["properties", "items", "allOf", "oneOf", "anyOf", "additionalProperties"]);

/**
 * Every enum under `components.schemas`, as `[name, values]` sorted by name.
 *
 * @throws when two enums with different values would get the same name.
 */
export function collectEnums(document) {
  const schemas = document?.components?.schemas ?? {};
  const found = new Map();

  const note = (name, values) => {
    const previous = found.get(name);
    if (previous && JSON.stringify(previous) !== JSON.stringify(values)) {
      throw new Error(`two enums with different values are both named ${name}`);
    }
    found.set(name, values);
  };

  const walk = (node, path) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, path);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.enum)) note(path.join("."), [...node.enum]);
    for (const [key, value] of Object.entries(node)) {
      if (key === "enum" || key === "example" || key === "examples" || key === "default") continue;
      // Under `properties` each key is a property name; elsewhere a keyword.
      if (key === "properties" && value && typeof value === "object") {
        for (const [property, schema] of Object.entries(value)) walk(schema, [...path, property]);
      } else if (TRANSPARENT.has(key)) {
        walk(value, path);
      }
    }
  };

  for (const [name, schema] of Object.entries(schemas)) walk(schema, [name]);
  return [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The generated module's text for `document`. Same document, same text. */
export function renderBuilderEnums(document) {
  const version = document?.info?.version;
  if (typeof version !== "string" || !version) throw new Error("the contract has no info.version");
  const lines = [
    "/**",
    " * The enums of Builder's contract. Generated — do not edit (#793).",
    " *",
    " * `scripts/generate-builder-enums.mjs` writes this file from Builder's",
    " * `contract/builder-api.yaml`; `builderEnums.test.ts` fails when it does not match the",
    " * contract of the version named below. Read it through `../builderEnums`.",
    " */",
    "",
    "/** The contract version this snapshot was generated from. */",
    `export const BUILDER_ENUMS_CONTRACT_VERSION = ${JSON.stringify(version)};`,
    "",
    "export const BUILDER_ENUMS = {",
  ];
  for (const [name, values] of collectEnums(document)) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(values)},`);
  }
  lines.push("} as const;", "");
  return lines.join("\n");
}

function contractPath(args) {
  const index = args.indexOf("--contract");
  const given = index !== -1 ? args[index + 1] : process.env.BUILDER_CONTRACT;
  if (!given) {
    throw new Error("no contract: pass --contract <path> or set BUILDER_CONTRACT");
  }
  return resolve(given);
}

export function main(args = process.argv.slice(2), output = OUTPUT) {
  let text;
  try {
    text = renderBuilderEnums(parse(readFileSync(contractPath(args), "utf8")));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (args.includes("--check")) {
    let current;
    try {
      current = readFileSync(output, "utf8");
    } catch {
      current = null;
    }
    if (current !== text) {
      console.error("src/shared/lib/generated/builderEnums.ts is stale: run scripts/generate-builder-enums.mjs");
      return 1;
    }
    console.log("src/shared/lib/generated/builderEnums.ts matches the contract");
    return 0;
  }
  writeFileSync(output, text, "utf8");
  console.log("wrote src/shared/lib/generated/builderEnums.ts");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
