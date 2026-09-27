/**
 * Studio BuildSpec (camelCase) ↔ Builder BuildSpec (snake_case) mapping (#37).
 *
 * Transforms specs written in Studio to the field names/structure expected by Builder.
 * Builder accepts YAML, but JSON is a subset of YAML, so the mapped object can be
 * serialized to JSON and sent as the `spec` field in `/validate` and `/build` requests.
 *
 * Key transformations:
 *   - datasetId → dataset_id
 *   - exports[].format → exports[].kind (+ output_path derived)
 *   - sources fields (provider/dataset/params/alias) keep the same names.
 */
import type { BuildSpec, ExportTarget, JsonValue, SourceFormat, SourceKind } from "@/shared/lib/types";

/** Export target expected by Builder (snake_case). */
interface BuilderExport {
  kind: string;
  output_path: string;
  options?: Record<string, JsonValue>;
}

/** Source reference expected by Builder (snake_case, #498 kind=public_api/file/url). */
interface BuilderSourceRef {
  kind?: SourceKind;
  provider?: string;
  dataset?: string;
  /**
   * Builder loader.py SSOT (_FILE_ONLY_FIELDS/_URL_ONLY_FIELDS) rejects `params` as a
   * foreign field if present as a key in kind=file/url — send only for public_api (#283 follow-up review §1).
   */
  params?: Record<string, JsonValue>;
  alias?: string;
  /** source schema contract (VAL-1). Same structure as Studio SourceRef.schema. */
  schema?: {
    required: string[];
    dtypes: Record<string, string>;
    casts: Record<string, string>;
  };
  upload_id?: string;
  format?: SourceFormat;
  encoding?: string;
  endpoint?: string;
  method?: "GET";
}

/** BuildSpec expected by Builder (snake_case). */
export interface BuilderSpec {
  dataset_id: string;
  title: string;
  description: string;
  sources: BuilderSourceRef[];
  exports: BuilderExport[];
  metadata: Record<string, JsonValue>;
}

/** Top-level canonical fields explicitly modeled by `toBuilderSpec`/`fromBuilderSpec`. */
const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "dataset_id",
  "title",
  "description",
  "sources",
  "exports",
  "metadata",
]);

const FORMAT_EXTENSION: Record<string, string> = {
  jsonl: "jsonl",
  markdown: "md",
  parquet: "parquet",
  huggingface: "",
};

/** Derive output_path per export. huggingface targets a directory; others target file paths. */
function deriveOutputPath(spec: BuildSpec, target: ExportTarget, index: number): string {
  const explicitPath = target.options?.["outputPath"];
  if (typeof explicitPath === "string" && explicitPath.length > 0) return explicitPath;

  const base = typeof spec.metadata["outputPath"] === "string"
    ? spec.metadata["outputPath"]
    : `artifacts/builds/${spec.datasetId}`;
  if (target.format === "huggingface") {
    return index === 0 ? base : `${base}-${index + 1}`;
  }
  const extension = FORMAT_EXTENSION[target.format] ?? target.format;
  const suffix = index === 0 ? "" : `-${index + 1}`;
  return `${base}/data${suffix}.${extension}`;
}

/**
 * Transform Studio BuildSpec to Builder BuildSpec structure.
 *
 * First expand `spec.extra` (#250, canonical round-trip), then overwrite with fields
 * actually edited in Studio. This preserves top-level fields not modeled by the GUI
 * (publish/splits/pii/...) while ensuring form-edited values always take precedence.
 *
 * @param spec - Studio BuildSpec (camelCase).
 * @returns snake_case spec object expected by Builder.
 */
export function toBuilderSpec(spec: BuildSpec): BuilderSpec {
  return {
    ...(spec.extra ?? {}),
    dataset_id: spec.datasetId,
    title: spec.title,
    description: spec.description,
    sources: spec.sources.map((source) => ({
      ...(source.kind && source.kind !== "public_api" ? { kind: source.kind } : {}),
      ...(source.provider !== undefined ? { provider: source.provider } : {}),
      ...(source.dataset !== undefined ? { dataset: source.dataset } : {}),
      // Builder loader.py rejects `params` as a foreign field if it exists as a key in kind=file/url —
      // send only for public_api (omit kind).
      ...(!source.kind || source.kind === "public_api" ? { params: source.params } : {}),
      ...(source.alias ? { alias: source.alias } : {}),
      ...(source.schema ? { schema: source.schema } : {}),
      ...(source.uploadId ? { upload_id: source.uploadId } : {}),
      ...(source.format ? { format: source.format } : {}),
      ...(source.encoding ? { encoding: source.encoding } : {}),
      ...(source.endpoint ? { endpoint: source.endpoint } : {}),
      ...(source.method ? { method: source.method } : {}),
    })),
    exports: spec.exports.map((target, index) => ({
      kind: target.format,
      output_path: deriveOutputPath(spec, target, index),
      ...(target.options ? { options: target.options } : {}),
    })),
    metadata: spec.metadata,
  };
}

/**
 * Serialize Studio BuildSpec to spec text received by Builder (JSON=YAML subset).
 *
 * @param spec - Studio BuildSpec.
 * @returns String for the spec field in `/validate` and `/build` requests.
 */
export function serializeSpec(spec: BuildSpec): string {
  return JSON.stringify(toBuilderSpec(spec));
}

/**
 * Reverse-map Builder BuildSpec (snake_case) to Studio BuildSpec (camelCase).
 *
 * Inverse of toBuilderSpec(). Used when loading saved specs from Builder to re-edit in Studio
 * (#120), and when parsing specs from YAML editor to reflect in GUI (#250).
 *
 * `spec` may carry arbitrary top-level keys beyond those `BuilderSpec` explicitly models
 * (raw parsed YAML object) — these are not discarded but preserved in `extra` (#250 canonical
 * field round-trip). Callers validate with Zod *only* and must always pass the original object
 * right after parsing — Zod `.parse()` result will silently strip schema-unknown keys.
 *
 * Parameter type is `BuilderSpec` (known fields only), but at runtime may actually carry any
 * keys like a raw YAML-parsed object — TypeScript just cannot see them.
 */
export function fromBuilderSpec(spec: BuilderSpec): BuildSpec {
  const extra: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(spec as unknown as Record<string, unknown>)) {
    if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) extra[key] = value as JsonValue;
  }

  return {
    datasetId: spec.dataset_id,
    title: spec.title,
    description: spec.description,
    sources: spec.sources.map((source) => ({
      ...(source.kind && source.kind !== "public_api" ? { kind: source.kind } : {}),
      ...(source.provider !== undefined ? { provider: source.provider } : {}),
      ...(source.dataset !== undefined ? { dataset: source.dataset } : {}),
      // file/url sources from wire have no params — Studio SourceRef.params is still
      // required, so fill with empty object.
      params: source.params ?? {},
      ...(source.alias ? { alias: source.alias } : {}),
      ...(source.schema ? { schema: source.schema } : {}),
      ...(source.upload_id ? { uploadId: source.upload_id } : {}),
      ...(source.format ? { format: source.format } : {}),
      ...(source.encoding ? { encoding: source.encoding } : {}),
      ...(source.endpoint ? { endpoint: source.endpoint } : {}),
      ...(source.method ? { method: source.method } : {}),
    })),
    exports: spec.exports.map((e) => {
      // Builder output_path has no corresponding field in Studio ExportTarget, so store in options (#121).
      const options: Record<string, JsonValue> = { ...(e.options ?? {}) };
      if (e.output_path) {
        options["outputPath"] = e.output_path;
      }
      return {
        format: e.kind,
        ...(Object.keys(options).length > 0 ? { options } : {}),
      };
    }),
    metadata: spec.metadata,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}
