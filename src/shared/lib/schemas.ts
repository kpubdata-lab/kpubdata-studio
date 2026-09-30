/**
 * collection of zod-based input/domain schemas used by Studio.
 *
 * runtime validation rules ensuring form inputs and API payloads don't violate shared type contracts.
 */
import { i18n } from "@/shared/i18n";
import { z } from "zod";

/** enum schema limiting list of supported export formats */
export const exportFormatSchema = z.enum([
  "markdown",
  "jsonl",
  "parquet",
  "huggingface",
]);

export type JsonValueInput = string | number | boolean | null | JsonValueInput[] | { [key: string]: JsonValueInput };

export const jsonValueSchema: z.ZodType<JsonValueInput> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
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

/** source schema contract (VAL-1). 1:1 mapping with Builder sources[].schema. */
export const schemaContractSchema = z.object({
  required: z.array(z.string()),
  dtypes: z.record(z.string(), z.string()),
  casts: z.record(z.string(), z.string()),
});

/** kind="public_api" (default) / file / url distinction(#498). */
export const sourceKindSchema = z.enum(["public_api", "file", "url"]);

/** Formats actually supported by kind="file"/"url" source (per Builder #498 contract). */
export const sourceFormatSchema = z.enum(["csv", "json", "jsonl", "parquet"]);

/** upload_id format issued by `POST /uploads` (Builder #498: `upl_` + 32 hex chars). */
export const uploadIdSchema = z.string().regex(/^upl_[a-f0-9]{32}$/, { error: () => i18n.t("schemas.uploadIdFormat") });

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
    kind: sourceKindSchema.optional(),
    provider: z.string().optional(),
    dataset: z.string().optional(),
    params: jsonRecordSchema,
    alias: z.string().min(1, { error: () => i18n.t("schemas.aliasEmpty") }).optional(),
    schema: schemaContractSchema.optional(),
    uploadId: uploadIdSchema.optional(),
    format: sourceFormatSchema.optional(),
    encoding: z.string().optional(),
    endpoint: z.string().optional(),
    method: z.literal("GET").optional(),
  })
  .superRefine((source, ctx) => {
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
  });

/** schema validating export target definition */
export const exportTargetSchema = z.object({
  format: z.string().min(1, { error: () => i18n.t("schemas.exportFormatRequired") }),
  options: exportOptionsSchema.optional(),
});

/** schema validating entire spec structure generated from new build screen */
export const buildSpecSchema = z.object({
  datasetId: z.string().min(1, { error: () => i18n.t("schemas.datasetIdRequired") }),
  title: z.string().min(1, { error: () => i18n.t("schemas.titleRequired") }),
  description: z.string().min(1, { error: () => i18n.t("schemas.descriptionRequired") }),
  sources: z.array(sourceRefSchema).min(1, { error: () => i18n.t("schemas.sourcesRequired") }),
  exports: z.array(exportTargetSchema).min(1, { error: () => i18n.t("schemas.exportsRequired") }),
  metadata: jsonRecordSchema,
  // canonical top-level fields not provided UI editing in Studio (publish/splits/pii/...)
  // bucket preserving through round-trip without loss (#250). see specMapping.ts.
  extra: jsonRecordSchema.optional(),
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
