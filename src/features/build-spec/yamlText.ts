/**
 * Canonical BuildSpec GUI ↔ YAML text conversions (#250, #251).
 *
 * Module dedicated to the "YAML" tab of the BuildSpecEditor — the payload actually
 * submitted to the Builder does not go through this module (the single source of
 * truth for submission is `serializeSpec` in `specMapping.ts`, which reuses
 * `toBuilderSpec`). This module only handles editing convenience: producing a
 * human-friendly YAML string (`toYamlText`) and converting that string back into
 * the Studio BuildSpec (`fromYamlText`).
 *
 * Distinguish two layers of errors:
 *  - YAML syntax error: when the `yaml` parser cannot parse the text.
 *  - Structural error: parsed but not shaped like the canonical BuildSpec
 *    (missing required top-level keys, sources/exports not arrays, etc.).
 * Builder `/validate` semantic errors (e.g. provider does not exist) are out of
 * scope for this module — we do not reproduce or replace those semantics here.
 */
import { i18n } from "@/shared/i18n";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { fromBuilderSpec, toBuilderSpec, type BuilderSpec } from "@/features/build-spec/specMapping";
import type { BuildSpec } from "@/shared/lib/types";

/** When the YAML parser fails to parse the text (syntax error). */
export class YamlSyntaxError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : i18n.t("buildSpec.yaml.parseFailed"));
    this.name = "YamlSyntaxError";
  }
}

/** When parsing succeeds but the value is not a canonical BuildSpec (structure error, distinct from Builder semantic errors). */
export class BuildSpecShapeError extends Error {
  constructor(readonly issues: string[]) {
    super(i18n.t("buildSpec.yaml.invalidShape", { issues: issues.join(", ") }));
    this.name = "BuildSpecShapeError";
  }
}

// The loose schema intentionally remains permissive about required top-level keys
// and structure. `.passthrough()` lets fields that Studio does not model
// (publish/splits/pii/license/quality/composition, etc.) pass through as-is to
// avoid accidentally stripping values that exist. sources[]/exports[] only enforce
// required keys per item and pass the rest — detailed kind-specific conditions
// are the Builder `/validate` (semantic) responsibility.
const looseSourceRefSchema = z.object({ params: z.record(z.string(), z.unknown()).optional() }).passthrough();
const looseExportTargetSchema = z.object({ kind: z.string(), output_path: z.string() }).passthrough();

const canonicalSpecShapeSchema = z
  .object({
    dataset_id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    sources: z.array(looseSourceRefSchema).min(1),
    exports: z.array(looseExportTargetSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * Serialize a Studio BuildSpec into a human-friendly canonical YAML text.
 *
 * `toBuilderSpec` (the same mapping used for submission) is stringified to YAML —
 * the underlying values are the same as the submission payload; only the
 * representation (YAML vs JSON) differs.
 *
 * @param spec - Studio-side BuildSpec.
 * @returns Editable YAML text.
 */
export function toYamlText(spec: BuildSpec): string {
  return stringifyYaml(toBuilderSpec(spec));
}

/**
 * Convert YAML text back into a Studio BuildSpec.
 *
 * @param text - YAML text edited by the user.
 * @returns The mapped BuildSpec.
 * @throws YamlSyntaxError when YAML cannot be parsed.
 * @throws BuildSpecShapeError when parsing succeeds but the value is not a canonical BuildSpec.
 */
export function fromYamlText(text: string): BuildSpec {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    throw new YamlSyntaxError(cause);
  }

  // Perform structural validation via safeParse only (to avoid stripping unknown
  // fields), and pass the original raw object to fromBuilderSpec as-is — passing
  // the Zod result would silently remove top-level keys (publish/splits/...) and
  // break round-trip fidelity (#250 amendment 2).
  const result = canonicalSpecShapeSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
    throw new BuildSpecShapeError(issues);
  }

  return fromBuilderSpec(raw as BuilderSpec);
}
