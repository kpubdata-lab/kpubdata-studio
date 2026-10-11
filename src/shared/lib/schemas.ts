/**
 * collection of zod-based input/domain schemas used by Studio.
 *
 * runtime validation rules ensuring form inputs and API payloads don't violate shared type contracts.
 */
import { i18n } from "@/shared/i18n";
import * as z from "zod/mini";

/** enum schema limiting list of supported export formats */
export const exportFormatSchema = z.enum([
  "markdown",
  "jsonl",
  "parquet",
  "huggingface",
]);

export type JsonValueInput = string | number | boolean | null | JsonValueInput[] | { [key: string]: JsonValueInput };

export const jsonValueSchema: z.ZodMiniType<JsonValueInput> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const recordSchema = z.record(z.string(), z.string());

export const jsonRecordSchema = z.record(z.string(), jsonValueSchema);

/** export options allow arbitrary values (unknown) for string keys (aligned with ExportTarget.options contract) */
export const exportOptionsSchema = z.record(z.string(), jsonValueSchema);

/**
 * source schema contract (VAL-1). 1:1 mapping with Builder sources[].schema.
 *
 * Loose: Builder's `SchemaContract` also carries rename/read_as/null_tokens/coalesce/zfill/
 * derived/... that Studio does not edit. A strict object would strip them on every parse
 * (#601), changing Silver normalization on re-save.
 */
export const schemaContractSchema = z.looseObject({
  required: z.array(z.string()),
  dtypes: z.record(z.string(), z.string()),
  casts: z.record(z.string(), z.string()),
});

/** Builder `SourceRef.gold.filters[]` (contract 1.64.0). */
export const sourceGoldFilterSchema = z.object({
  column: z.string(),
  op: z.enum(["eq", "ne", "gt", "ge", "lt", "le", "in", "not_null"]),
  value: z.optional(jsonValueSchema),
});

/**
 * Builder `SourceRef.gold` (#659, #689; camelCase in Studio). Parsed so a saved or
 * re-validated spec keeps its Gold limits and declared PII columns (#601).
 */
export const sourceGoldSchema = z.object({
  select: z.optional(z.array(z.string())),
  filters: z.optional(z.array(sourceGoldFilterSchema)),
  piiColumns: z.optional(z.array(z.string())),
  publishUnmasked: z.optional(z.array(z.string())),
});

/** kind="public_api" (default) / file / url distinction(#498). */
export const sourceKindSchema = z.enum(["public_api", "file", "url"]);

/** Formats actually supported by kind="file"/"url" source (per Builder #498 contract). */
export const sourceFormatSchema = z.enum(["csv", "json", "jsonl", "parquet"]);

/** upload_id format issued by `POST /uploads` (Builder #498: `upl_` + 32 hex chars). */
export const uploadIdSchema = z.string().check(z.regex(/^upl_[a-f0-9]{32}$/, { error: () => i18n.t("schemas.uploadIdFormat") }));

/**
 * schema validating fields that single source data reference must have (#250, #498).
 *
 * required fields by kind are enforced via `superRefine` instead of a
 * discriminated union — the same pattern as the Builder contract
 * (SourceRef) itself, which expresses no conditional requirements in its
 * OpenAPI object schema and lets the loader/validator enforce them over
 * `additionalProperties: true`.
 */
export const sourceRefSchema = z
  .object({
    kind: z.optional(sourceKindSchema),
    provider: z.optional(z.string()),
    dataset: z.optional(z.string()),
    params: jsonRecordSchema,
    alias: z.optional(z.string().check(z.minLength(1, { error: () => i18n.t("schemas.aliasEmpty") }))),
    schema: z.optional(schemaContractSchema),
    uploadId: z.optional(uploadIdSchema),
    format: z.optional(sourceFormatSchema),
    encoding: z.optional(z.string()),
    endpoint: z.optional(z.string()),
    method: z.optional(z.literal("GET")),
    // Builder `param_grid` (#613) — carried through, never edited (#601).
    paramGrid: z.optional(z.record(z.string(), z.array(jsonValueSchema))),
    gold: z.optional(sourceGoldSchema),
    // Source-level contract fields Studio does not model (#601). See specMapping.ts.
    extra: z.optional(jsonRecordSchema),
  }).check(z.superRefine((source, ctx) => {
    const kind = source.kind ?? "public_api";
    if (kind === "public_api") {
      if (!source.provider) {
        ctx.addIssue({ code: "custom", path: ["provider"], message: i18n.t("schemas.providerRequired") });
      }
      if (!source.dataset) {
        ctx.addIssue({ code: "custom", path: ["dataset"], message: i18n.t("schemas.sourceDatasetRequired") });
      }
    } else if (kind === "file") {
      if (!source.uploadId) {
        ctx.addIssue({ code: "custom", path: ["uploadId"], message: i18n.t("schemas.uploadRequired") });
      }
      if (!source.format) {
        ctx.addIssue({ code: "custom", path: ["format"], message: i18n.t("schemas.formatRequired") });
      }
    } else if (kind === "url") {
      if (!source.endpoint) {
        ctx.addIssue({ code: "custom", path: ["endpoint"], message: i18n.t("schemas.endpointRequired") });
      } else if (!/^https:\/\//i.test(source.endpoint)) {
        ctx.addIssue({ code: "custom", path: ["endpoint"], message: i18n.t("schemas.httpsOnly") });
      }
      if (source.format && !["csv", "json", "jsonl"].includes(source.format)) {
        ctx.addIssue({ code: "custom", path: ["format"], message: i18n.t("schemas.urlFormats") });
      }
    }
  }));

/** schema validating export target definition */
export const exportTargetSchema = z.object({
  format: z.string().check(z.minLength(1, { error: () => i18n.t("schemas.exportFormatRequired") })),
  options: z.optional(exportOptionsSchema),
});

/** schema validating entire spec structure generated from new build screen */
export const buildSpecSchema = z.object({
  datasetId: z.string().check(z.minLength(1, { error: () => i18n.t("schemas.datasetIdRequired") })),
  title: z.string().check(z.minLength(1, { error: () => i18n.t("schemas.titleRequired") })),
  description: z.string().check(z.minLength(1, { error: () => i18n.t("schemas.descriptionRequired") })),
  sources: z.array(sourceRefSchema).check(z.minLength(1, { error: () => i18n.t("schemas.sourcesRequired") })),
  exports: z.array(exportTargetSchema).check(z.minLength(1, { error: () => i18n.t("schemas.exportsRequired") })),
  metadata: jsonRecordSchema,
  // canonical top-level fields not provided UI editing in Studio (publish/splits/pii/...)
  // bucket preserving through round-trip without loss (#250). see specMapping.ts.
  extra: z.optional(jsonRecordSchema),
});

/**
 * schema validating New Build Wizard form input values (actual form persisted as localStorage draft).
 *
 * used to safely filter broken or outdated shapes when restoring a saved
 * draft (#84). Describes the form-input shape, not the executable build
 * spec (`buildSpecSchema`).
 */
export const buildFormValuesSchema = z.object({
  datasetId: z.string(),
  title: z.string(),
  description: z.string(),
  provider: z.string(),
  sourceDataset: z.string(),
  sourceParams: z.string(),
  outputPath: z.string(),
  exportFormats: z.array(z.string()),
});

/** inferred form input type from passing buildFormValuesSchema */
export type BuildFormValuesInput = z.infer<typeof buildFormValuesSchema>;

/** inferred input type from passing buildSpecSchema */
export type BuildSpecInput = z.infer<typeof buildSpecSchema>;
/** inferred input type from passing exportTargetSchema */
export type ExportTargetInput = z.infer<typeof exportTargetSchema>;
/** inferred input type from passing sourceRefSchema */
export type SourceRefInput = z.infer<typeof sourceRefSchema>;
