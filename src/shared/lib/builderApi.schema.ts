/**
 * Builder API response Zod schema (#158, #103, #159)
 *
 * Zod schemas for runtime type validation of Builder HTTP API responses.
 * Written to stay consistent with the Builder SSOT (contract/builder-api.yaml).
 *
 * Usage:
 * - Runtime-validate responses with zod.parse() after parsing in apiFetch()
 * - TypeScript type safety + runtime data consistency
 * - Error responses are also schema-validated for explicit user feedback (#159)
 */

import { z } from "zod";

/**
 * GET /version response schema
 */
export const versionResponseSchema = z.object({
  service: z.string(),
  api_version: z.string(),
  /** Application release (ADR 0004). Absent on Builders that predate it — not a mismatch (#430). */
  version: z.string().optional(),
});

/**
 * POST /validate response schema (validation succeeded)
 */
export const validateValidSchema = z.object({
  status: z.literal("valid"),
  dataset_id: z.string(),
  api_version: z.string(),
});

/**
 * POST /validate response schema (validation failed - list of issues)
 */
export const validateInvalidSchema = z.object({
  status: z.literal("invalid"),
  problems: z.array(z.string()),
});

/**
 * POST /validate response schema (spec loading error)
 */
export const validateErrorSchema = z.object({
  status: z.literal("error"),
  error: z.string(),
});

/**
 * POST /validate unified response schema
 */
export const validateResponseSchema = z.discriminatedUnion("status", [
  validateValidSchema,
  validateInvalidSchema,
  validateErrorSchema,
]);

/**
 * Build outcome (BuildOutcome) schema
 */
export const buildOutcomeSchema = z.object({
  source_key: z.string(),
  status: z.string(),
  stages_completed: z.array(z.string()),
  error: z.string().nullable(),
});

/**
 * POST /build response schema (build succeeded)
 */
export const buildOkSchema = z.object({
  status: z.literal("ok"),
  run_id: z.string(),
  outcomes: z.array(buildOutcomeSchema),
  manifest: z.string(),
  api_version: z.string(),
});

/**
 * POST /build response schema (build failed - one or more sources failed)
 */
export const buildFailedSchema = z.object({
  status: z.literal("failed"),
  run_id: z.string(),
  outcomes: z.array(buildOutcomeSchema),
  manifest: z.string(),
  api_version: z.string(),
  error: z.string(),
});

/**
 * POST /build unified response schema
 */
export const buildResponseSchema = z.discriminatedUnion("status", [
  buildOkSchema,
  buildFailedSchema,
]);

/**
 * Async build job snapshot — GET /builds/{run_id} / POST /builds response (#245, builder 1.16.0 #480).
 *
 * `cancelling`/`cancelled` are reserved vocabulary ahead of builder #481
 * cooperative cancellation (no endpoint currently causes the transition).
 * `response` is the final build response body of a successful job.
 */
export const buildJobSchema = z.object({
  run_id: z.string(),
  status: z.enum(["queued", "running", "cancelling", "succeeded", "failed", "cancelled"]),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable().optional(),
  response: buildResponseSchema.nullable().optional(),
  error: z.string().nullable().optional(),
});

export type BuildJob = z.infer<typeof buildJobSchema>;

/**
 * GET /artifacts/{run_id} response schema
 */
export const artifactsResponseSchema = z.object({
  run_id: z.string(),
  files: z.array(z.string()),
});

/** GET /builds/{run_id}/manifest response. Builder contract allows extension fields, so preserve them. */
export const buildManifestResponseSchema = z.object({
  build_id: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  schema_version: z.string(),
  status: z.enum(["ok", "failed", "cancelled"]).optional(),
  partial: z.boolean().optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  row_counts: z.record(z.string(), z.number().int()).optional(),
  inputs_fingerprint: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
}).loose();

/**
 * How Builder sends a column's values (builder#735, API contract 1.30.0).
 *
 * `decimal_string`: the values are exact decimal text — every Decimal column, and an
 * integer column holding a value outside ±(2^53−1). Never pass them through `Number()`:
 * a JSON number is a double, and `9007199254740993` becomes `…992`.
 *
 * Optional everywhere: a Builder older than 1.30.0 does not send it.
 *
 * Extensible (#497): a value this Studio does not know parses as `"unsupported"` instead
 * of failing the whole response, and the cell says so rather than guessing a number out
 * of it. A non-string is still a type error. The known values stay a plain enum as the
 * first branch so the contract drift check can compare them with Builder's.
 */
export const knownWireEncodingSchema = z.enum(["number", "decimal_string", "string", "boolean", "json"]);
export const UNSUPPORTED_WIRE_ENCODING = "unsupported";
export const wireEncodingSchema = z.union([
  knownWireEncodingSchema,
  z.string().transform((): typeof UNSUPPORTED_WIRE_ENCODING => UNSUPPORTED_WIRE_ENCODING),
]);

export const columnWireInfoSchema = z.object({
  name: z.string(),
  logical_type: z.string(),
  wire_encoding: wireEncodingSchema,
});

/**
 * Preview column schema item
 */
export const previewColumnSchema = z.object({
  name: z.string(),
  dtype: z.string(),
  nullable: z.boolean(),
  unique_count: z.number(),
  logical_type: z.string().optional(),
  wire_encoding: wireEncodingSchema.optional(),
});

// previewSourceSchema/previewResponseSchema depend on tableStatisticsSchema and qualityCheckResultSchema
// (see line 152 comment), so define them after those schemas are declared (after Quality section) — const has
// TDZ so references before declaration become runtime errors.

/**
 * ============================================
 * Error response schema (#159)
 * ============================================
 */

/**
 * 400 - Spec loading failed (SpecLoadError)
 */
export const specLoadErrorSchema = z.object({
  status: z.literal("error"),
  error: z.string(),
});

/**
 * 400 - Request body missing/format error
 */
export const badRequestSchema = z.object({
  error: z.string(),
});

/**
 * 404 - Resource not found
 */
export const notFoundSchema = z.object({
  error: z.string(),
});

/**
 * 502 - Source fetch/stage failed (some succeeded, at least one failed)
 *
 * Note: the outcomes array mixes successful/failed sources; if even one
 * source failed, the overall status is "failed".
 */
export const buildPartialFailureSchema = z.object({
  status: z.literal("failed"),
  run_id: z.string(),
  outcomes: z.array(buildOutcomeSchema),
  manifest: z.string(),
  api_version: z.string(),
});

/**
 * Unified Error response schema
 *
 * validates various error response forms of Builder API.
 * Ordinary z.union() instead of discriminatedUnion.
 */
export const errorResponseSchema = z.union([
  // 400 - Spec loading failed (already in validateResponseSchema)
  validateErrorSchema,
  // 400 - Request body error
  badRequestSchema,
  // 404 - Resource not found
  notFoundSchema,
  // 502 - Build partially failed (already in buildResponseSchema.failed)
  buildPartialFailureSchema,
]);

// Type extraction (extracted from Zod schema to match TypeScript types)
export type VersionResponse = z.infer<typeof versionResponseSchema>;
export type ValidateValid = z.infer<typeof validateValidSchema>;
export type ValidateInvalid = z.infer<typeof validateInvalidSchema>;
export type ValidateError = z.infer<typeof validateErrorSchema>;
export type ValidateResponse = z.infer<typeof validateResponseSchema>;
export type BuildOutcome = z.infer<typeof buildOutcomeSchema>;
export type BuildOk = z.infer<typeof buildOkSchema>;
export type BuildFailed = z.infer<typeof buildFailedSchema>;
export type BuildResponse = z.infer<typeof buildResponseSchema>;
export type ArtifactsResponse = z.infer<typeof artifactsResponseSchema>;
export type BuildManifestResponse = z.infer<typeof buildManifestResponseSchema>;
export type PreviewColumn = z.infer<typeof previewColumnSchema>;
export type PreviewDiffItem = z.infer<typeof previewDiffItemSchema>;
export type PreviewTransformSummary = z.infer<typeof previewTransformSummarySchema>;
export type PreviewSource = z.infer<typeof previewSourceSchema>;
export type PreviewResponse = z.infer<typeof previewResponseSchema>;

// Error response type (#159)
export type SpecLoadError = z.infer<typeof specLoadErrorSchema>;
export type BadRequest = z.infer<typeof badRequestSchema>;
export type NotFound = z.infer<typeof notFoundSchema>;
export type BuildPartialFailure = z.infer<typeof buildPartialFailureSchema>;

/**
 * GET /catalog search metadata list query capability (#490).
 */
export const catalogQuerySupportSchema = z.object({
  pagination: z.enum(["offset", "index", "cursor", "none"]),
  filterable_fields: z.array(z.string()),
  sortable_fields: z.array(z.string()),
  time_range: z.boolean(),
  max_page_size: z.number().int().positive().nullable(),
});

/**
 * GET /catalog response schema (#416, BL2; #Extended search metadata with #490)
 */
/**
 * GET /catalog search metadata safe (secret-free) request parameter description (#S-add-data).
 * Serialized by Builder from an allowlist over raw_metadata — secret
 * parameters such as serviceKey are excluded. Unknown datasets get an empty
 * array.
 */
export const catalogRequestParameterSchema = z.object({
  name: z.string(),
  required: z.boolean(),
  description: z.string().nullable(),
  example: z.string().nullable(),
});

/**
 * For cases where API Key issuance and per-dataset access requests are separate (like Public Data Portal)
 * guidance (#S-add-data). Passed through by Builder from
 * raw_metadata.application — null if missing (meaning unknown, NOT "no
 * activation request needed"). Studio never guesses application/approval
 * status from this field — a successful Preview is the final confirmation.
 */
export const catalogApplicationSchema = z.object({
  required: z.boolean(),
  url: z.string(),
});

export const catalogDatasetSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  source_url: z.string().nullable(),
  representation: z.enum(["api_json", "api_xml", "file_csv", "file_excel", "sheet", "other"]),
  operations: z.array(z.enum(["list", "get", "schema", "raw", "download"])),
  query_support: catalogQuerySupportSchema.nullable(),
  requires_service_key: z.boolean(),
  // Backward compat: parsing does not break on old Builder versions that don't send this field yet
  // (consumer uses `?? []`). Latest Builder always sends an array.
  request_parameters: z.array(catalogRequestParameterSchema).optional(),
  // Backward compat: this field is undefined on old Builder versions that don't send it yet
  // (consumer uses `?? null`). Latest Builder always sends a value (object or null).
  application: catalogApplicationSchema.nullable().optional(),
  // Provider wording for the daily cap, from the spec (kpubdata-builder#778). Optional: a
  // Builder that does not send it yet, or a spec that does not declare it, reads as unknown.
  quota: z.string().nullable().optional(),
});

export const catalogProviderSchema = z.object({
  name: z.string(),
  datasets: z.array(catalogDatasetSchema),
});

export const catalogResponseSchema = z.object({
  providers: z.array(catalogProviderSchema),
});

export type CatalogQuerySupport = z.infer<typeof catalogQuerySupportSchema>;
export type CatalogRequestParameter = z.infer<typeof catalogRequestParameterSchema>;
export type CatalogApplication = z.infer<typeof catalogApplicationSchema>;
export type CatalogDataset = z.infer<typeof catalogDatasetSchema>;
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

/**
 * ============================================
 * Provider connection test / Uploads (#492, #498)
 * ============================================
 */

/** GET /providers — runtime Provider list and current principal's configured status(#492).
 *  Contains no credential plaintext (the server sends only booleans). */
export const providerSummarySchema = z.object({
  provider: z.string(),
  requires_credential: z.boolean(),
  configured: z.boolean(),
});

export const providersResponseSchema = z.object({
  providers: z.array(providerSummarySchema),
});

/** POST /providers/{provider}/test, GET /providers/{provider}/status common response. */
export const providerTestResponseSchema = z.object({
  provider: z.string(),
  status: z.enum(["connected", "failed", "not_configured"]),
  configured: z.boolean(),
  latency_ms: z.number().int().nonnegative(),
  checked_at: z.string(),
  error_category: z.enum(["auth", "network", "timeout", "provider", "unknown"]).optional(),
  response_code: z.number().int().min(100).max(599).optional(),
});

/**
 * GET /providers/{provider}/credential — metadata only of credential saved by current principal
 * returns (ADR 0012). No raw secret in any field. `configured` means this
 * user personally saved a credential — distinct from the GET /providers
 * summary's `configured` (effective provider configuration: user credential
 * > server default > none). `masked`/`updated_at` are null if a saved
 * credential is missing.
 *
 * Strict on purpose — the one response schema that is (#497). Every other response
 * strips fields it does not know so an additive Builder change cannot break a screen.
 * This one answers "what do you hold for my secret?", so any field beyond the three
 * metadata ones is treated as a possible secret leak and rejected loudly, not dropped
 * quietly.
 */
export const providerCredentialResponseSchema = z.object({
  configured: z.boolean(),
  masked: z.string().nullable(),
  updated_at: z.string().nullable(),
}).strict();

/** kind="file" source upload metadata (secret-free, no content). */
export const uploadMetadataSchema = z.object({
  upload_id: z.string().regex(/^upl_[a-f0-9]{32}$/),
  format: z.enum(["csv", "json", "jsonl", "parquet"]),
  encoding: z.string(),
  size_bytes: z.number().int().nonnegative(),
  original_filename: z.string().nullable(),
  created_at: z.string(),
});

export type ProviderSummary = z.infer<typeof providerSummarySchema>;
export type ProvidersResponse = z.infer<typeof providersResponseSchema>;
export type ProviderTestResponse = z.infer<typeof providerTestResponseSchema>;
export type ProviderCredentialResponse = z.infer<typeof providerCredentialResponseSchema>;
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;

/**
 * ============================================
 * Built Dataset / Stage / Quality API (1.6.0)
 * ============================================
 */

export const stageStatusSchema = z.enum(["completed", "failed", "not_run", "unavailable"]);

export const datasetSourceRefSchema = z.object({
  provider: z.string(),
  dataset: z.string(),
  alias: z.string(),
});

export const sourceStageStatusSchema = z.object({
  bronze: stageStatusSchema,
  silver: stageStatusSchema,
  gold: stageStatusSchema,
});

export const datasetStageMapSchema = z.record(z.string(), sourceStageStatusSchema);

/**
 * A table's state on each status axis (builder#781, API 1.37+), as Builder's OpenAPI
 * contract defines `status_axes`. One field per axis, never merged into one badge; an
 * axis with nothing to go on is `unknown`. The `access` values are the contract's enum,
 * taken as they are.
 */
export const datasetStatusAxesSchema = z.object({
  refresh: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "unknown"]),
  completeness: z.enum(["complete", "partial", "unknown"]),
  health: z.enum(["healthy", "stale", "degraded", "unknown"]),
  access: z.enum([
    "available",
    "auth_unknown",
    "application_required",
    "params_invalid",
    "rate_limited",
    "temporarily_unavailable",
    "network_error",
    "insufficient_metadata",
    "retired",
    "unknown",
  ]),
  maturity: z.enum(["stable", "beta", "experimental", "unknown"]),
});

export const datasetSummarySchema = z.object({
  dataset_id: z.string(),
  title: z.string(),
  sources: z.array(datasetSourceRefSchema),
  latest_run_id: z.string(),
  status: z.enum(["ok", "failed", "cancelled"]),
  updated_at: z.string().nullable(),
  row_counts: z.record(z.string(), z.number().int()),
  total_row_count: z.number().int(),
  stages: datasetStageMapSchema,
  quality: z.null(),
  // Optional: an Builder older than builder#781 does not send it; Studio then shows none.
  status_axes: datasetStatusAxesSchema.optional(),
});

export const datasetDetailResponseSchema = datasetSummarySchema.extend({
  run_count: z.number().int(),
});

export const datasetsResponseSchema = z.object({
  datasets: z.array(datasetSummarySchema),
  // `total` is an additive field added in Builder 1.22.0 (canonical grouping +
  // distinct dataset count after ownership, before pagination). Builder 1.21.0 and earlier
  // don't send this field, so it's optional — if missing, Studio displays "unknown" and
  // doesn't use items.length/limit as total.
  total: z.number().int().nonnegative().optional(),
});

export const datasetRunSummarySchema = z.object({
  run_id: z.string(),
  status: z.enum(["ok", "failed", "cancelled"]),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  spec_digest: z.string().nullable(),
  created_by: z.string().nullable(),
});

/** GET /datasets/{dataset_id}/runs/{run_id} (builder 1.31.0, #418): one run found by id. */
export const datasetRunResponseSchema = z.object({
  dataset_id: z.string(),
  run: datasetRunSummarySchema,
});

export const datasetRunsResponseSchema = z.object({
  dataset_id: z.string(),
  runs: z.array(datasetRunSummarySchema),
});

export const stageStateSchema = z.object({
  status: stageStatusSchema,
  available: z.boolean(),
});

export const runStageEntrySchema = z.object({
  source_key: z.string(),
  bronze: stageStateSchema,
  silver: stageStateSchema,
  gold: stageStateSchema,
});

export const runStagesResponseSchema = z.object({
  run_id: z.string(),
  sources: z.array(runStageEntrySchema),
});

// Response schemas strip keys they do not model (zod's default) rather than rejecting them
// (#497): an Builder that adds an optional field must not break the screen that reads the
// response. Required keys and their types are still checked. See
// __tests__/responseSchemaAdditive.test.tsx for the gate.
const stageDetailBase = {
  run_id: z.string(),
  source_key: z.string(),
  status: stageStatusSchema,
  available: z.boolean(),
};

export const bronzeStageDetailResponseSchema = z.object({
  ...stageDetailBase,
  stage: z.literal("bronze"),
  provider: z.string().nullable(),
  dataset: z.string().nullable(),
  fetched_at: z.string().nullable(),
  record_count: z.number().int().nullable(),
});

export const silverColumnInfoSchema = z.object({
  name: z.string(),
  dtype: z.string(),
  nullable: z.boolean(),
  unique_count: z.number().int(),
  // builder#735 (1.30.0). Absent for runs written before 1.30.0. (This schema used to be
  // strict, which is why a 1.30.0 Builder needed Studio to ship first — #497.)
  logical_type: z.string().optional(),
  wire_encoding: wireEncodingSchema.optional(),
});

export const tableStatisticsSchema = z.object({
  row_count: z.number().int(),
  null_counts: z.record(z.string(), z.number().int()),
  duplicate_rate: z.number(),
});

export const silverValidationProblemSchema = z.object({
  code: z.string(),
  field: z.string().nullable(),
  message: z.string(),
});

export const silverValidationResultSchema = z.object({
  ok: z.boolean(),
  problems: z.array(silverValidationProblemSchema),
});

export const silverStageDetailResponseSchema = z.object({
  ...stageDetailBase,
  stage: z.literal("silver"),
  row_count: z.number().int().nullable(),
  schema: z.array(silverColumnInfoSchema),
  statistics: tableStatisticsSchema.nullable(),
  validation: silverValidationResultSchema.nullable(),
  sample: z.array(z.record(z.string(), z.json())),
});

export const goldExportSummarySchema = z.object({ kind: z.string() });

export const goldStageDetailResponseSchema = z.object({
  ...stageDetailBase,
  stage: z.literal("gold"),
  row_count: z.number().int().nullable(),
  columns: z.array(z.string()),
  splits: z.record(z.string(), z.number().int()).nullable(),
  exports: z.array(goldExportSummarySchema),
  sample: z.null(),
  sample_available: z.literal(false),
});

export const stageDetailResponseSchema = z.discriminatedUnion("stage", [
  bronzeStageDetailResponseSchema,
  silverStageDetailResponseSchema,
  goldStageDetailResponseSchema,
]);

export const qualityCheckResultSchema = z.object({
  source_key: z.string(),
  category: z.string(),
  rule: z.string(),
  column: z.string().nullable(),
  status: z.enum(["pass", "warn", "fail"]),
  actual: z.json(),
  threshold: z.json(),
  affected_rows: z.number().int().nullable(),
  evaluated_rows: z.number().int().nullable(),
  detail: z.string().nullable(),
});

/**
 * One cell-level change between Preview and Silver (#497). appears only in diffs for sources where diff_available=true.
 */
export const previewDiffItemSchema = z.object({
  row: z.number().int().nonnegative(),
  column: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  transform: z.string().nullable(),
});

/**
 * Change summary calculated from comparable sample range (#497).
 */
export const previewTransformSummarySchema = z.object({
  changed_cells: z.number().int().nonnegative(),
  changed_rows: z.number().int().nonnegative(),
});

/**
 * Preview source-specific preview item (extended with statistics/quality_results/diff via the #497 field expansion).
 */
export const previewSourceSchema = z.object({
  source_key: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  schema: z.array(previewColumnSchema),
  sample: z.array(z.record(z.string(), z.unknown())),
  total_rows: z.number(),
  statistics: tableStatisticsSchema,
  quality_results: z.array(qualityCheckResultSchema),
  /** Bronze original sample before transformation. Can be populated as best effort even if diff_available=false. */
  source_sample: z.array(z.record(z.string(), z.unknown())),
  sample_mode: z.enum(["first", "random"]),
  diff_available: z.boolean(),
  diffs: z.array(previewDiffItemSchema),
  transform_summary: previewTransformSummarySchema.nullable(),
  diff_truncated: z.boolean(),
});

/**
 * POST /preview response schema
 */
export const previewResponseSchema = z.object({
  dataset_id: z.string(),
  previews: z.array(previewSourceSchema),
});

export const schemaDriftFindingSchema = z.object({
  kind: z.enum(["column_added", "column_removed", "dtype_changed", "row_count_jump"]),
  column: z.string().nullable(),
  detail: z.string(),
});

export const qualityAvailabilitySchema = z.enum(["available", "partial", "unavailable"]);

export const buildQualityResponseSchema = z.object({
  run_id: z.string(),
  availability: qualityAvailabilitySchema,
  evaluated_checks: z.number().int().nonnegative(),
  quality_results: z.record(z.string(), z.array(qualityCheckResultSchema)),
  schema_drift: z.record(z.string(), z.array(schemaDriftFindingSchema)),
});

export const datasetQualityHistoryEntrySchema = z.object({
  run_id: z.string(),
  timestamp: z.string().nullable(),
  status: z.enum(["ok", "failed", "cancelled"]),
  pass_count: z.number().int(),
  warn_count: z.number().int(),
  fail_count: z.number().int(),
  evaluated_checks: z.number().int(),
  rule_pass_rate: z.number().nullable(),
  validated_rows: z.number().int().nullable(),
});

export const datasetQualityHistoryResponseSchema = z.object({
  dataset_id: z.string(),
  runs: z.array(datasetQualityHistoryEntrySchema),
});

/**
 * GET /quality/summary — recent 24h cross-run quality aggregate (Builder 1.22.0, #486 follow-up).
 * The Home "QUALITY WARN (24H)" KPI reads this
 * authoritative value with no synthesized numbers. Contains no per-run
 * quality_results/dataset/owner.
 */
export const qualitySummaryResponseSchema = z.object({
  window: z.literal("24h"),
  generated_at: z.string(),
  availability: z.enum(["available", "unavailable"]),
  total_runs: z.number().int().nonnegative(),
  evaluated_runs: z.number().int().nonnegative(),
  pass_runs: z.number().int().nonnegative(),
  warn_runs: z.number().int().nonnegative(),
  fail_runs: z.number().int().nonnegative(),
});

/**
 * ============================================
 * Build Publish API (1.17.0, builder #491 / PR #547)
 * ============================================
 */

export const publishTargetSchema = z.literal("huggingface");

export const publishIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const publishReadinessResponseSchema = z.object({
  run_id: z.string(),
  target: publishTargetSchema,
  ready: z.boolean(),
  blockers: z.array(publishIssueSchema),
  warnings: z.array(publishIssueSchema),
});

// Requests Studio sends stay strict (#497): a typo'd or stale key here is Studio's own
// bug and should fail before it reaches the Builder. Only responses tolerate additions.
export const publishHuggingFaceOptionsSchema = z.object({
  private: z.boolean().default(true),
}).strict();

export const publishRequestSchema = z.object({
  target: publishTargetSchema,
  destination: z.string(),
  options: publishHuggingFaceOptionsSchema.optional(),
}).strict();

export const publishResponseSchema = z.object({
  run_id: z.string(),
  target: publishTargetSchema,
  publisher: z.string(),
  destination: z.string(),
  reference: z.string(),
  artifact_count: z.number().int().nonnegative(),
  status: z.string(),
});

export const publishErrorCodeSchema = z.enum([
  "unsupported_target",
  "publish_in_progress",
  "publish_state_unknown",
  "publish_conflict",
  "publish_failed",
]);

export const publishErrorResponseSchema = z.object({
  error: z.string(),
  code: publishErrorCodeSchema.optional(),
});

export const publishBlockedResponseSchema = z.object({
  error: z.string(),
  blockers: z.array(publishIssueSchema),
});

/**
 * ============================================
 * Read-only Query API (1.7.0, #504)
 * ============================================
 */

export const queryStageSchema = z.enum(["silver", "gold"]);

export const queryRequestSchema = z.object({
  dataset_id: z.string().min(1),
  run_id: z.string().min(1),
  stage: queryStageSchema,
  source: z.string().min(1).optional(),
  sql: z.string().min(1).max(65536),
  limit: z.number().int().min(1).max(500).optional(),
});

export const jsonQueryValueSchema = z.json();

export const queryResponseSchema = z.object({
  columns: z.array(z.string()),
  // builder#735 (1.30.0): per column, whether its values arrive as exact decimal text.
  column_meta: z.array(columnWireInfoSchema).optional(),
  rows: z.array(z.record(z.string(), jsonQueryValueSchema)),
  truncated: z.boolean(),
  execution_ms: z.number().int().nonnegative(),
});

/** Builder `/query` error response: includes client-branch `code` unlike other endpoints. */
export const queryErrorCodeSchema = z.enum([
  "forbidden",
  "artifact_unavailable",
  "invalid_context",
  "unsafe_query",
  "query_busy",
  "query_timeout",
  "query_execution_failed",
  "invalid_request",
]);

export const queryErrorResponseSchema = z.object({
  error: z.string(),
  code: queryErrorCodeSchema.optional(),
});

export type QueryStage = z.infer<typeof queryStageSchema>;
export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type QueryResponse = z.infer<typeof queryResponseSchema>;
export type QueryErrorCode = z.infer<typeof queryErrorCodeSchema>;
export type QueryErrorResponse = z.infer<typeof queryErrorResponseSchema>;

export type StageStatus = z.infer<typeof stageStatusSchema>;
export type DatasetSourceRef = z.infer<typeof datasetSourceRefSchema>;
export type SourceStageStatus = z.infer<typeof sourceStageStatusSchema>;
export type DatasetSummary = z.infer<typeof datasetSummarySchema>;
export type DatasetStatusAxes = z.infer<typeof datasetStatusAxesSchema>;
export type DatasetDetailResponse = z.infer<typeof datasetDetailResponseSchema>;
export type DatasetsResponse = z.infer<typeof datasetsResponseSchema>;
export type DatasetRunSummary = z.infer<typeof datasetRunSummarySchema>;
export type DatasetRunResponse = z.infer<typeof datasetRunResponseSchema>;
export type DatasetRunsResponse = z.infer<typeof datasetRunsResponseSchema>;
export type RunStageEntry = z.infer<typeof runStageEntrySchema>;
export type RunStagesResponse = z.infer<typeof runStagesResponseSchema>;
export type StageDetailResponse = z.infer<typeof stageDetailResponseSchema>;
export type QualityCheckResult = z.infer<typeof qualityCheckResultSchema>;
export type SchemaDriftFinding = z.infer<typeof schemaDriftFindingSchema>;
export type QualityAvailability = z.infer<typeof qualityAvailabilitySchema>;
export type BuildQualityResponse = z.infer<typeof buildQualityResponseSchema>;
export type DatasetQualityHistoryEntry = z.infer<typeof datasetQualityHistoryEntrySchema>;
export type DatasetQualityHistoryResponse = z.infer<typeof datasetQualityHistoryResponseSchema>;
export type QualitySummaryResponse = z.infer<typeof qualitySummaryResponseSchema>;

/**
 * Monitoring (#516) — Builder actual wire contract (GET /monitoring/summary,
 * verbatim. The availability vocabulary is the same
 * available/partial/unavailable shared with quality (#486); never-measured
 * values come back as null, never disguised as 0 (#516 principle).
 */
const monitoringAvailabilitySchema = z.enum(["available", "partial", "unavailable"]);

export const monitoringApiStatusSchema = z.object({
  availability: monitoringAvailabilitySchema,
  sample_count: z.number().int().nullable(),
  p95_latency_ms: z.number().nullable(),
});

export const monitoringQueueSchema = z.object({
  availability: monitoringAvailabilitySchema,
  waiting: z.number().int().nullable(),
  running: z.number().int().nullable(),
  total: z.number().int().nullable(),
});

export const monitoringWorkersSchema = z.object({
  availability: monitoringAvailabilitySchema,
  active: z.number().int(),
  capacity: z.number().int(),
  utilization: z.number(),
});

export const monitoringArtifactStoreSchema = z.object({
  availability: monitoringAvailabilitySchema,
  last_write_at: z.string().nullable(),
});

/** GET /monitoring/summary response. Aggregate status is 2-value: healthy/degraded(#516). */
export const monitoringSummaryResponseSchema = z.object({
  generated_at: z.string(),
  status: z.enum(["healthy", "degraded"]),
  api: monitoringApiStatusSchema,
  queue: monitoringQueueSchema,
  workers: monitoringWorkersSchema,
  artifact_store: monitoringArtifactStoreSchema,
});

export const monitoringBucketSchema = z.object({
  bucket_start: z.string(),
  bucket_end: z.string(),
  total: z.number().int(),
  success: z.number().int(),
  failed: z.number().int(),
  cancelled: z.number().int(),
});

/**
 * recent run status passes BuildIndex internal value as-is (builder sends as
 * serialized as str) — in-flight statuses beyond ok/failed/cancelled can
 * appear, so a plain string is accepted instead of a narrow enum; display
 * mapping is the UI's job.
 */
export const monitoringRecentRunSchema = z.object({
  run_id: z.string(),
  status: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});

/** GET /monitoring/builds?window=24h&bucket=hour response (#516). */
export const monitoringBuildsResponseSchema = z.object({
  window: z.string(),
  bucket: z.string(),
  availability: monitoringAvailabilitySchema,
  excluded_count: z.number().int(),
  buckets: z.array(monitoringBucketSchema),
  recent_runs: z.array(monitoringRecentRunSchema),
});

export type MonitoringAvailability = z.infer<typeof monitoringAvailabilitySchema>;
export type MonitoringApiStatus = z.infer<typeof monitoringApiStatusSchema>;
export type MonitoringQueueStats = z.infer<typeof monitoringQueueSchema>;
export type MonitoringWorkerStats = z.infer<typeof monitoringWorkersSchema>;
export type MonitoringArtifactStoreStats = z.infer<typeof monitoringArtifactStoreSchema>;
export type MonitoringSummaryResponse = z.infer<typeof monitoringSummaryResponseSchema>;
export type MonitoringBucket = z.infer<typeof monitoringBucketSchema>;
export type MonitoringRecentRun = z.infer<typeof monitoringRecentRunSchema>;
export type MonitoringBuildsResponse = z.infer<typeof monitoringBuildsResponseSchema>;
export type PublishTarget = z.infer<typeof publishTargetSchema>;
export type PublishIssue = z.infer<typeof publishIssueSchema>;
export type PublishReadinessResponse = z.infer<typeof publishReadinessResponseSchema>;
export type PublishHuggingFaceOptions = z.infer<typeof publishHuggingFaceOptionsSchema>;
export type PublishRequest = z.input<typeof publishRequestSchema>;
export type PublishResponse = z.infer<typeof publishResponseSchema>;
export type PublishErrorCode = z.infer<typeof publishErrorCodeSchema>;
export type PublishErrorResponse = z.infer<typeof publishErrorResponseSchema>;
export type PublishBlockedResponse = z.infer<typeof publishBlockedResponseSchema>;

/**
 * ============================================
 * BuildSpec snapshot (#487) / structured run events (#496)
 * ============================================
 */

/** GET /builds/{run_id}/spec response. Canonical (redacted) YAML and digest that the run used. */
export const buildSpecSnapshotResponseSchema = z.object({
  run_id: z.string(),
  spec: z.string(),
  spec_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

export const buildEventNameSchema = z.enum([
  "run_submitted",
  "run_started",
  "run_finished",
  "run_failed",
  // Builder has emitted this for a cancelled async run since builder#481. Missing
  // here, every cancelled run's timeline failed to parse.
  "run_cancelled",
  "source_fetch_started",
  // One per finished param_grid combination (builder#648), so a long fetch shows
  // progress instead of going silent.
  "source_fetch_progress",
  "source_fetch_completed",
  "source_fetch_failed",
  "stage_started",
  "stage_completed",
  "stage_failed",
  "quality_evaluated",
]);

export const buildEventStatusSchema = z.enum(["ok", "warn", "fail"]);

/** Medallion stage (bronze/silver/gold) + export execution stage. Separate vocabulary from RunStagesResponse 3-stage. */
export const buildEventStageNameSchema = z.enum(["bronze", "silver", "gold", "export"]);

/** Single structured run event (#496). Bounded fields only — no raw logs/stack traces/free-form objects. */
export const buildEventSchema = z.object({
  seq: z.number().int(),
  timestamp: z.string(),
  run_id: z.string(),
  event: buildEventNameSchema,
  status: buildEventStatusSchema,
  source_key: z.string().nullable(),
  stage: buildEventStageNameSchema.nullable(),
  message: z.string().nullable(),
  metrics: z.record(z.string(), z.json()).nullable(),
});

export const buildEventsResponseSchema = z.object({
  run_id: z.string(),
  events: z.array(buildEventSchema),
});

export type BuildSpecSnapshotResponse = z.infer<typeof buildSpecSnapshotResponseSchema>;
export type BuildEventName = z.infer<typeof buildEventNameSchema>;
export type BuildEventStatus = z.infer<typeof buildEventStatusSchema>;
export type BuildEventStageName = z.infer<typeof buildEventStageNameSchema>;
export type BuildEvent = z.infer<typeof buildEventSchema>;
export type BuildEventsResponse = z.infer<typeof buildEventsResponseSchema>;

/*
 * ============================================
 * Administrator (builder#679, contract 1.28+)
 * ============================================
 * Metadata and policy state only — the contract forbids artifact bytes, credentials
 * and response bodies here. These schemas strip unknown keys (#497): an additive field
 * no longer breaks the page, and nothing Studio does not model — a credential included —
 * survives parsing, so it still never reaches the screen.
 */

export const adminConfigResponseSchema = z.object({
  enforce_ownership: z.boolean(),
  publish_server_credential_fallback: z.boolean(),
});

export const adminRunSchema = z.object({
  run_id: z.string(),
  status: z.string(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  /** Irreversible owner hash — not an identity. */
  owner_id: z.string().nullable().optional(),
});

export const adminRunsResponseSchema = z.object({
  runs: z.array(adminRunSchema),
  count: z.number().int().nonnegative(),
});

export type AdminConfigResponse = z.infer<typeof adminConfigResponseSchema>;
export type AdminRun = z.infer<typeof adminRunSchema>;
export type AdminRunsResponse = z.infer<typeof adminRunsResponseSchema>;

/*
 * ============================================
 * Warehouse and saved analyses (builder#797, #783; contract 1.38+)
 * ============================================
 * A deployment without a warehouse answers GET /warehouse/tables with 404
 * `warehouse_not_configured`; Studio then keeps the run-based query path.
 */

export const warehouseTableSchema = z.object({
  table_id: z.string(),
  /** `<dataset_id>.<source_key>` — the name a query uses. */
  logical_name: z.string(),
  current_snapshot_id: z.string().nullable(),
  revision: z.number().int().nonnegative(),
});

export const warehouseTableListResponseSchema = z.object({ tables: z.array(warehouseTableSchema) });

export const warehouseSnapshotSchema = z.object({
  snapshot_id: z.string(),
  run_id: z.string(),
  state: z.enum(["committed", "quarantined"]),
  row_count: z.number().int().nonnegative().nullable(),
  created_at: z.string(),
  committed_at: z.string().nullable(),
});

export const warehouseTableDetailResponseSchema = warehouseTableSchema.extend({
  snapshots: z.array(warehouseSnapshotSchema),
});

export const warehouseQueryRequestSchema = z.object({
  table: z.string().min(1),
  snapshot: z.string().min(1).optional(),
  sql: z.string().min(1).max(65536),
  limit: z.number().int().min(1).max(500).optional(),
});

export const pinnedSnapshotSchema = z.object({
  table_id: z.string(),
  logical_name: z.string(),
  snapshot_id: z.string(),
  revision: z.number().int().nonnegative(),
});

export const warehouseQueryResponseSchema = z.object({
  snapshot: pinnedSnapshotSchema,
  result: queryResponseSchema,
});

export const savedAnalysisSchema = z.object({
  analysis_id: z.string(),
  name: z.string(),
  sql: z.string(),
  limit: z.number().int(),
  /** Concrete snapshot ids, never `current`. */
  bindings: z.array(z.object({ table: z.string(), snapshot_id: z.string() })),
  result_meta: z.object({
    columns: z.array(z.string()),
    column_meta: z.array(columnWireInfoSchema),
    row_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
    executed_at: z.string(),
  }),
  created_at: z.string(),
});

export const analysisListResponseSchema = z.object({ analyses: z.array(savedAnalysisSchema) });

export const createAnalysisRequestSchema = warehouseQueryRequestSchema.extend({
  name: z.string().min(1).max(200),
});

export const createAnalysisResponseSchema = z.object({
  analysis: savedAnalysisSchema,
  result: queryResponseSchema,
});

export const analysisDeletedResponseSchema = z.object({ analysis_id: z.string(), deleted: z.literal(true) });

export type WarehouseTable = z.infer<typeof warehouseTableSchema>;
export type WarehouseTableDetailResponse = z.infer<typeof warehouseTableDetailResponseSchema>;
export type WarehouseSnapshot = z.infer<typeof warehouseSnapshotSchema>;
export type WarehouseQueryRequest = z.infer<typeof warehouseQueryRequestSchema>;
export type WarehouseQueryResponse = z.infer<typeof warehouseQueryResponseSchema>;
export type SavedAnalysis = z.infer<typeof savedAnalysisSchema>;
export type CreateAnalysisRequest = z.infer<typeof createAnalysisRequestSchema>;
export type CreateAnalysisResponse = z.infer<typeof createAnalysisResponseSchema>;
