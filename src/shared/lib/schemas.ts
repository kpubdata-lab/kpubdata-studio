/**
 * collection of zod-based input/domain schemas used by Studio.
 *
 * runtime validation to ensure form inputs and API payloads don't violate shared type contracts 규칙을 제공한다.
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
export const uploadIdSchema = z.string().regex(/^upl_[a-f0-9]{32}$/, i18n.t("schemas.uploadIdFormat"));

/**
 * schema validating fields that single source data reference must have (#250, #498).
 *
 * required fields by kind are discriminatedd union 대신 `superRefine`으로 강제한다 — Builder
 * 계약(SourceRef) 자체가 OpenAPI object schema로 조건부 필수를 표현하지 않고
 * `additionalProperties: true` 위에서 loader/validator가 강제하는 것과 같은 패턴이다.
 */
export const sourceRefSchema = z
  .object({
    kind: sourceKindSchema.optional(),
    provider: z.string().optional(),
    dataset: z.string().optional(),
    params: jsonRecordSchema,
    alias: z.string().min(1, "Alias cannot be empty.").optional(),
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
        ctx.addIssue({ code: "custom", path: ["provider"], message: "Provider is required." });
      }
      if (!source.dataset) {
        ctx.addIssue({ code: "custom", path: ["dataset"], message: "Dataset is required." });
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
  format: z.string().min(1, "Export format is required."),
  options: exportOptionsSchema.optional(),
});

/** schema validating entire spec structure generated from new build screen */
export const buildSpecSchema = z.object({
  datasetId: z.string().min(1, "Dataset ID is required."),
  title: z.string().min(1, "Title is required."),
  description: z.string().min(1, "Description is required."),
  sources: z.array(sourceRefSchema).min(1, "At least one source is required."),
  exports: z.array(exportTargetSchema).min(1, "Select at least one export format."),
  metadata: jsonRecordSchema,
  // canonical top-level fields not provided UI editing in Studio (publish/splits/pii/...)
  // bucket preserving through round-trip without loss (#250). see specMapping.ts.
  extra: jsonRecordSchema.optional(),
});

/**
 * schema validating New Build Wizard form input values (actual form persisted as localStorage draft).
 *
 * saved draft (#84)을 복원할 때 형태가 깨졌거나 오래된 버전인 경우를 안전하게 걸러내기 위해
 * 사용한다. 빌드 실행용 스펙(`buildSpecSchema`)이 아니라 폼 입력 형태를 기술한다.
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
