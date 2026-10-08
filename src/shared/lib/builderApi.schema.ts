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
import { builderEnum } from "./builderEnums";

/**
 * GET /version response schema
 */
export const versionResponseSchema = z.object({
  service: z.string(),
  api_version: z.string(),
  /** Application release (ADR 0004). Absent on Builders that predate it — not a mismatch (#430). */
  version: z.string().optional(),
  /**
   * Where this deployment takes publish credentials from (kpubdata-builder#938, 1.69.0):
   * `request` — only the request's `X-Publish-Credential` header (multi-user); `stored` —
   * only the requester's stored credential; `stored_or_server` — the stored one, else the
   * server's. Absent on older Builders, and a value Studio does not know reads as absent,
   * so either way the publish page falls back to inferring it from readiness (#637).
   */
  publish_credential: builderEnum("VersionResponse.publish_credential").optional().catch(undefined),
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
 *
 * `response` is whatever body the job's build produced — the contract types it only as
 * `object | null` (#603). A succeeded job may carry a minimal `{run_id, status}`, and a
 * job that failed before a build body existed carries an error body such as
 * `{error: "provider client unavailable"}`. Requiring the full `POST /build` shape here
 * rejected those jobs, so the poll reported a schema mismatch instead of the job's
 * `status`/`error`. Consumers narrow it with `buildJobResponseSchema`, which checks only
 * what they read. The contract's "success only" wording is kpubdata-builder#921.
 */
export const buildJobSchema = z.object({
  run_id: z.string(),
  status: builderEnum("BuildJob.status"),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable().optional(),
  response: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  /**
   * A stable reason for a failure Builder itself caused (builder#996). A string, not an
   * enum: a reason added later must not make the whole job unreadable.
   */
  code: z.string().optional(),
  /** The earlier run this one was submitted as a retry of (builder#1042); absent otherwise. */
  retry_of: z.string().optional(),
});

/**
 * The parts of a job's `response` Studio reads, each optional (#603).
 *
 * Only the fields that decide a partial failure are checked: the body's `status`, its
 * top-level `error` and each outcome's `error`. Anything else in the body is ignored.
 */
export const buildJobResponseSchema = z.object({
  status: z.string().optional(),
  error: z.string().nullable().optional(),
  outcomes: z.array(z.object({ error: z.string().nullable().optional() })).optional(),
});

export type BuildJob = z.infer<typeof buildJobSchema>;
export type BuildJobResponse = z.infer<typeof buildJobResponseSchema>;

/**
 * GET /artifacts/{run_id} response schema
 */
export const artifactsResponseSchema = z.object({
  run_id: z.string(),
  files: z.array(z.string()),
});

/**
 * One provenance entry of a dataset card (`DatasetCardSource`, contract 1.75.0, #646).
 * `license_declared`, `license_provider` and `license_mismatch` are sent from 1.75.0; a
 * card written before that lacks them, so they are optional here.
 */
export const datasetCardSourceSchema = z.object({
  source: z.string(),
  institution: z.string(),
  url: z.string(),
  license: z.string(),
  collected_at: z.string(),
  license_declared: z.string().nullable().optional(),
  license_provider: z.string().nullable().optional(),
  license_mismatch: z.boolean().optional(),
});

/**
 * A Gold output's `card.json` (`DatasetCard`, kpubdata-builder#906/#955), served by
 * `GET /artifacts/{run_id}/{file_path}` for `gold/<source>/card.json`. Read the
 * structured fields rather than the sentences; `processing_declared` is sent from 1.75.0.
 */
export const datasetCardSchema = z.object({
  card_version: z.number().int(),
  title: z.string(),
  provenance: z.array(datasetCardSourceSchema),
  processing: z.array(z.string()),
  processing_declared: z.boolean().optional(),
  personal_information: z.string(),
});

export type DatasetCard = z.infer<typeof datasetCardSchema>;
export type DatasetCardSource = z.infer<typeof datasetCardSourceSchema>;

/** GET /builds/{run_id}/manifest response. Builder contract allows extension fields, so preserve them. */
export const buildManifestResponseSchema = z.object({
  build_id: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  schema_version: z.string(),
  status: builderEnum("BuildManifest.status").optional(),
  partial: z.boolean().optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  row_counts: z.record(z.string(), z.number().int()).optional(),
  inputs_fingerprint: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  // What made the Gold ratio splits (builder#871, contract 1.70.0): `hash-sort-v2`, or a
  // newer value this Studio does not know yet. An open string, shown as sent. Absent when
  // no ratio split was declared, and in older manifests whose ratio splits are `shuffle-v1`.
  split_algorithm: z.string().optional(),
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
export const knownWireEncodingSchema = builderEnum("WireEncoding");
export const UNSUPPORTED_WIRE_ENCODING = "unsupported";
export const wireEncodingSchema = z.union([
  knownWireEncodingSchema,
  z.string().transform((): typeof UNSUPPORTED_WIRE_ENCODING => UNSUPPORTED_WIRE_ENCODING),
]);

/**
 * Where a column hint came from (builder#813, ADR 0019). An open string: a newer Builder
 * may add an origin, and the hint is still shown. `engine_inferred` is an estimate.
 */
export const columnMetaOriginSchema = z.string();

/** Optional per-column hints (builder#813, contract 1.41.0). Metadata only — never a cast. */
export const columnSemanticHintSchema = z.object({ kind: z.string(), origin: columnMetaOriginSchema });
export const columnDisplayHintSchema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  format: z.string().optional(),
  origin: columnMetaOriginSchema,
});
export const columnUnitHintSchema = z.object({
  name: z.string(),
  scale: z.number().optional(),
  origin: columnMetaOriginSchema,
});

export const columnWireInfoSchema = z.object({
  name: z.string(),
  logical_type: z.string(),
  wire_encoding: wireEncodingSchema,
  semantic: columnSemanticHintSchema.optional(),
  display: columnDisplayHintSchema.optional(),
  unit: columnUnitHintSchema.optional(),
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
  // Column hints (builder#813, ADR 0019), sent more often since kpubdata code columns became
  // identifiers (builder#702, 1.61.0). Kept, not stripped, so a screen can show them.
  semantic: columnSemanticHintSchema.optional(),
  display: columnDisplayHintSchema.optional(),
  unit: columnUnitHintSchema.optional(),
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
export type PublishCredentialSource = NonNullable<VersionResponse["publish_credential"]>;
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
  pagination: builderEnum("CatalogQuerySupport.pagination"),
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
  representation: builderEnum("CatalogDataset.representation"),
  operations: z.array(builderEnum("CatalogDataset.operations")),
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
/** The principal's last connection test of a provider (kpubdata-builder#842). */
export const providerLastTestSchema = z.object({
  status: builderEnum("ProviderSummary.last_test.status"),
  checked_at: z.string(),
  error_category: z.string().nullable(),
  response_code: z.number().int().nullable(),
  dataset: z.string().nullable(),
});

export const providerSummarySchema = z.object({
  provider: z.string(),
  requires_credential: z.boolean(),
  configured: z.boolean(),
  /**
   * The provider whose key this one calls with (kpubdata-builder#1085, contract 1.98.0):
   * its own name, or the one it shares a key with. Absent from an older Builder.
   */
  key_provider: z.string().optional(),
  /** Absent from a Builder before kpubdata-builder#842; null when never tested. */
  last_test: providerLastTestSchema.nullable().optional(),
});

export const providersResponseSchema = z.object({
  providers: z.array(providerSummarySchema),
});

/** One dataset's verdict in POST /providers/{provider}/probe (kpubdata-builder#802). */
export const providerProbeDatasetSchema = z.object({
  /** Dataset name within the provider, as GET /catalog lists it. */
  dataset: z.string(),
  /** The provider service it belongs to; an application is granted per service. */
  service_id: z.string(),
  // One of kpubdata's PROBE_STATUSES. Not an enum in the contract: a kpubdata release
  // may add one, and an unknown status is shown as it is rather than refused.
  status: z.string(),
  /** What the provider said, with no key in it. May be empty. */
  detail: z.string(),
  http_status: z.number().int().nullable(),
});

/**
 * POST /providers/{provider}/probe (kpubdata-builder#802, contract 1.87.0): what the key
 * in the request's `X-Provider-Key` header can reach, per dataset. Builder stores neither
 * the key nor this result.
 */
export const providerProbeResponseSchema = z.object({
  provider: z.string(),
  probed_at: z.string(),
  /** False when `not_probed` names a dataset. */
  complete: z.boolean(),
  datasets: z.array(providerProbeDatasetSchema),
  /** Datasets nothing was observed about (time budget, or no spec to probe with). */
  not_probed: z.array(z.string()),
});

/** POST /providers/{provider}/test, GET /providers/{provider}/status common response. */
export const providerTestResponseSchema = z.object({
  provider: z.string(),
  // `not_testable` (kpubdata-builder#842): no dataset can be called without guessing a
  // parameter. It says nothing about the key.
  status: builderEnum("ProviderTestResponse.status"),
  configured: z.boolean(),
  /** The dataset a `connected` test called (kpubdata-builder#842). */
  dataset: z.string().optional(),
  latency_ms: z.number().int().nonnegative(),
  checked_at: z.string(),
  error_category: builderEnum("ProviderTestResponse.error_category").optional(),
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
  format: builderEnum("UploadMetadata.format"),
  encoding: z.string(),
  size_bytes: z.number().int().nonnegative(),
  original_filename: z.string().nullable(),
  created_at: z.string(),
  /**
   * When Builder will delete the upload (builder#1047, contract 1.86.0): past it a spec
   * that names the upload no longer builds. Null when nothing will delete it; absent from
   * a Builder older than that contract.
   */
  expires_at: z.string().nullable().optional(),
});

/** GET /uploads — the requester's uploads, newest first (builder#1067, contract 1.96.0). */
export const uploadListSchema = z.object({
  uploads: z.array(uploadMetadataSchema),
});

export type ProviderLastTest = z.infer<typeof providerLastTestSchema>;
export type ProviderSummary = z.infer<typeof providerSummarySchema>;
export type ProvidersResponse = z.infer<typeof providersResponseSchema>;
export type ProviderTestResponse = z.infer<typeof providerTestResponseSchema>;
export type ProviderProbeDataset = z.infer<typeof providerProbeDatasetSchema>;
export type ProviderProbeResponse = z.infer<typeof providerProbeResponseSchema>;
export type ProviderCredentialResponse = z.infer<typeof providerCredentialResponseSchema>;
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;
export type UploadList = z.infer<typeof uploadListSchema>;

/**
 * ============================================
 * Built Dataset / Stage / Quality API (1.6.0)
 * ============================================
 */

export const stageStatusSchema = builderEnum("StageStatusValue");

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
  refresh: builderEnum("DatasetStatusAxes.refresh"),
  completeness: builderEnum("DatasetStatusAxes.completeness"),
  health: builderEnum("DatasetStatusAxes.health"),
  access: builderEnum("DatasetStatusAxes.access"),
  maturity: builderEnum("DatasetStatusAxes.maturity"),
});

export const datasetSummarySchema = z.object({
  dataset_id: z.string(),
  title: z.string(),
  sources: z.array(datasetSourceRefSchema),
  latest_run_id: z.string(),
  status: builderEnum("DatasetSummary.status"),
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

/**
 * One run in GET /builds (builder #250). `dataset_id`, `dataset_title`, `snapshot_id` and
 * `snapshots` (kpubdata-builder#844) are absent from an older Builder, so all optional:
 * absent means "not sent", null means the Builder could not read it or nothing committed.
 */
export const buildSummarySchema = z.object({
  run_id: z.string(),
  status: builderEnum("BuildSummary.status"),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  dataset_title: z.string().nullable().optional(),
  snapshot_id: z.string().nullable().optional(),
  snapshots: z
    .array(z.object({ logical_name: z.string(), snapshot_id: z.string() }))
    .optional(),
});

export const buildsResponseSchema = z.object({
  builds: z.array(buildSummarySchema),
});

export type BuildSummary = z.infer<typeof buildSummarySchema>;
export type BuildsResponse = z.infer<typeof buildsResponseSchema>;

export const datasetRunSummarySchema = z.object({
  run_id: z.string(),
  status: builderEnum("DatasetRunSummary.status"),
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
  // Column hints (builder#813, ADR 0019), sent more often since kpubdata code columns became
  // identifiers (builder#702, 1.61.0). Kept, not stripped, so a screen can show them.
  semantic: columnSemanticHintSchema.optional(),
  display: columnDisplayHintSchema.optional(),
  unit: columnUnitHintSchema.optional(),
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

/**
 * Why a Silver stage detail came back with an empty `sample` on purpose (builder#688, #900;
 * 1.65.0, 1.68.0). Absent when the sample was not withheld — an empty sample is then a
 * table with no rows.
 */
export const sampleWithheldReasonSchema = builderEnum("SilverStageDetailResponse.sample_withheld");

export const silverStageDetailResponseSchema = z.object({
  ...stageDetailBase,
  stage: z.literal("silver"),
  row_count: z.number().int().nullable(),
  schema: z.array(silverColumnInfoSchema),
  /** Declared PII columns masked in `sample` (builder#900, 1.68.0). Absent when none was. */
  masked_columns: z.array(z.string()).optional(),
  statistics: tableStatisticsSchema.nullable(),
  validation: silverValidationResultSchema.nullable(),
  sample_withheld: sampleWithheldReasonSchema.optional(),
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
  status: builderEnum("QualityCheckResult.status"),
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
  sample_mode: builderEnum("SourcePreview.sample_mode"),
  diff_available: z.boolean(),
  diffs: z.array(previewDiffItemSchema),
  transform_summary: previewTransformSummarySchema.nullable(),
  diff_truncated: z.boolean(),
  /**
   * Declared PII columns masked in `sample`, `source_sample` and `diffs` (builder#900,
   * 1.68.0): text holds the mask token, any other dtype null. Absent when none was masked.
   */
  masked_columns: z.array(z.string()).optional(),
  /**
   * Whether the rows fetched are the whole source (builder#1185, 1.109.0). A preview reads
   * a `public_api` source up to `limit` records or three pages; false when it stopped
   * there while the source had more, or when the source failed — `total_rows`,
   * `statistics` and `quality_results` then count the rows fetched. Absent from an earlier
   * Builder, which read the source to its end.
   */
  fetch_complete: z.boolean().optional(),
  /**
   * The provider's own count of the source's records (1.109.0), when one call stated it;
   * null otherwise — a `param_grid` total is never summed.
   */
  source_reported_total: z.number().int().nonnegative().nullable().optional(),
});

/**
 * POST /preview response schema
 */
export const previewResponseSchema = z.object({
  dataset_id: z.string(),
  previews: z.array(previewSourceSchema),
});

export const schemaDriftFindingSchema = z.object({
  kind: builderEnum("SchemaDriftFinding.kind"),
  column: z.string().nullable(),
  detail: z.string(),
});

export const qualityAvailabilitySchema = builderEnum("BuildQualityResponse.availability");

export const buildQualityResponseSchema = z.object({
  run_id: z.string(),
  availability: qualityAvailabilitySchema,
  evaluated_checks: z.number().int().nonnegative(),
  quality_results: z.record(z.string(), z.array(qualityCheckResultSchema)),
  schema_drift: z.record(z.string(), z.array(schemaDriftFindingSchema)),
});

/**
 * One row of GET /quality/issues (kpubdata-builder#843): a WARN/FAIL check (`kind: check`,
 * the per-run QualityCheckResult unchanged) or a schema drift finding (`kind: drift`,
 * `status: drift`) from a table's latest run.
 */
export const qualityIssueSchema = z.object({
  dataset_id: z.string(),
  title: z.string().nullable(),
  run_id: z.string(),
  finished_at: z.string().nullable(),
  source_key: z.string(),
  kind: builderEnum("QualityIssue.kind"),
  status: builderEnum("QualityIssue.status"),
  category: z.string().nullable(),
  check: qualityCheckResultSchema.nullable(),
  drift: schemaDriftFindingSchema.nullable(),
});

/**
 * Tables read by what their latest run says about quality. None of `not_evaluated`,
 * `partial` or `unreadable` is a pass.
 */
export const qualityIssuesCoverageSchema = z.object({
  tables: z.number().int().nonnegative(),
  evaluated: z.number().int().nonnegative(),
  not_evaluated: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  unreadable: z.number().int().nonnegative(),
});

/** GET /quality/issues — one page of findings across the caller's tables (#843). */
export const qualityIssuesResponseSchema = z.object({
  issues: z.array(qualityIssueSchema),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
  coverage: qualityIssuesCoverageSchema,
});

export type QualityIssue = z.infer<typeof qualityIssueSchema>;
export type QualityIssuesCoverage = z.infer<typeof qualityIssuesCoverageSchema>;
export type QualityIssuesResponse = z.infer<typeof qualityIssuesResponseSchema>;

export const datasetQualityHistoryEntrySchema = z.object({
  run_id: z.string(),
  timestamp: z.string().nullable(),
  status: builderEnum("DatasetQualityHistoryEntry.status"),
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
  availability: builderEnum("QualitySummaryResponse.availability"),
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

/** A source's terms on redistribution (#688, contract 1.65.0), from most to least open. */
export const redistributionValueSchema = builderEnum("RedistributionVerdict.verdict");

export const redistributionSourceVerdictSchema = z.object({
  source: z.string(),
  verdict: redistributionValueSchema,
  reason: z.string(),
});

/**
 * Whether a build's data may leave Builder: its most restricted source's verdict (#688).
 * Readiness reports it for the target's default options, a refused publish's 409 for
 * the request's.
 */
export const redistributionVerdictSchema = z.object({
  verdict: redistributionValueSchema,
  sources: z.array(redistributionSourceVerdictSchema),
});

/** The terms a successful publish went out under, as Builder also keeps in the receipt. */
export const publishRedistributionRecordSchema = z.object({
  verdict: redistributionValueSchema,
  sources: z.array(redistributionSourceVerdictSchema),
  kpubdata_version: z.string().nullable(),
  confirm_non_commercial: z.boolean(),
});

export const publishReadinessResponseSchema = z.object({
  run_id: z.string(),
  target: publishTargetSchema,
  ready: z.boolean(),
  blockers: z.array(publishIssueSchema),
  warnings: z.array(publishIssueSchema),
  // Null before the run has a manifest; absent from a Builder older than 1.65.0.
  redistribution: redistributionVerdictSchema.nullable().optional(),
});

// Requests Studio sends stay strict (#497): a typo'd or stale key here is Studio's own
// bug and should fail before it reaches the Builder. Only responses tolerate additions.
export const publishHuggingFaceOptionsSchema = z.object({
  private: z.boolean().default(true),
  // The publisher's statement that non-commercial data is published for that use (#688).
  // Builder refuses a `non_commercial` build without it (`non_commercial_unconfirmed`).
  confirm_non_commercial: z.boolean().optional(),
}).strict();

export const publishRequestSchema = z.object({
  target: publishTargetSchema,
  destination: z.string(),
  options: publishHuggingFaceOptionsSchema.optional(),
}).strict();

/**
 * POST /builds/{run_id}/publish/reconcile (builder#551, declared in the contract by
 * builder#994): what looking at the remote settled. `succeeded` — the destination exists
 * there, or the receipt already said so (`reconciled: false`). `reset` — nothing was found
 * and the receipt was deleted, so the publish may be sent again.
 */
export const publishReconcileResponseSchema = z.object({
  run_id: z.string(),
  state: builderEnum("PublishReconcileResponse.state"),
  reconciled: z.boolean(),
  fingerprint: z.string(),
  retry_allowed: z.boolean().optional(),
  result: z.record(z.string(), z.json()).optional(),
});
export type PublishReconcileResponse = z.infer<typeof publishReconcileResponseSchema>;

/**
 * DELETE /builds/{run_id}/publish/receipt (builder#551): the caller's receipt was deleted.
 * Nothing is undone remotely — what was published stays published.
 */
export const publishReceiptResetSchema = z.object({
  run_id: z.string(),
  state: z.literal("reset"),
  retry_allowed: z.literal(true),
  fingerprint: z.string(),
});
export type PublishReceiptReset = z.infer<typeof publishReceiptResetSchema>;

export const publishResponseSchema = z.object({
  run_id: z.string(),
  target: publishTargetSchema,
  publisher: z.string(),
  destination: z.string(),
  reference: z.string(),
  artifact_count: z.number().int().nonnegative(),
  status: z.string(),
  // Null when the run has no readable spec; absent from a Builder older than 1.65.0.
  redistribution: publishRedistributionRecordSchema.nullable().optional(),
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
  // The request's verdict (#688); every blocked 409 carries it, whatever the blocker.
  redistribution: redistributionVerdictSchema.nullable().optional(),
});

/**
 * ============================================
 * Read-only Query API (1.7.0, #504)
 * ============================================
 */

export const queryStageSchema = builderEnum("QueryRequest.stage");

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
  /**
   * `stage: silver` only (builder#900, 1.68.0): the query ran on a copy of the Silver table
   * with these declared PII columns masked. Absent when none was masked; Gold is masked
   * where it is built and does not name its columns here.
   */
  masked_columns: z.array(z.string()).optional(),
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
  // builder#688 (1.65.0): the source terms forbid redistribution; the data stays in Builder.
  "redistribution_forbidden",
  // builder#900 (1.68.0): a file holds declared PII unmasked (names the `columns`).
  "declared_pii_withheld",
  // builder#900 (1.68.0, 503): the kpubdata PII declaration could not be read (names the `dataset`).
  "pii_declaration_unavailable",
  // builder#961 (1.107.0, 400): the query needed more memory or temporary disk than the
  // deployment allows. Before, it answered `query_execution_failed`.
  "query_resource_limit",
]);

export const queryErrorResponseSchema = z.object({
  error: z.string(),
  code: queryErrorCodeSchema.optional(),
  /** `declared_pii_withheld`: the declared columns held unmasked. Names only. */
  columns: z.array(z.string()).optional(),
  /** `pii_declaration_unavailable`: the dataset whose declaration was unreadable. */
  dataset: z.string().optional(),
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
export type SampleWithheldReason = z.infer<typeof sampleWithheldReasonSchema>;
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
const monitoringAvailabilitySchema = builderEnum("MonitoringApiStatus.availability");

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

// The contract's MonitoringWorkerStatus sends null for the counts when the pool is
// unavailable (#607, found by the contract drift check) — never 0 in disguise.
export const monitoringWorkersSchema = z.object({
  availability: monitoringAvailabilitySchema,
  active: z.number().int().nullable(),
  capacity: z.number().int().nullable(),
  utilization: z.number().nullable(),
});

export const monitoringArtifactStoreSchema = z.object({
  availability: monitoringAvailabilitySchema,
  last_write_at: z.string().nullable(),
});

/** GET /monitoring/summary response. Aggregate status is 2-value: healthy/degraded(#516). */
export const monitoringSummaryResponseSchema = z.object({
  generated_at: z.string(),
  status: builderEnum("MonitoringSummaryResponse.status"),
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
export type RedistributionValue = z.infer<typeof redistributionValueSchema>;
export type RedistributionVerdict = z.infer<typeof redistributionVerdictSchema>;
export type PublishRedistributionRecord = z.infer<typeof publishRedistributionRecordSchema>;

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

// Two of the values have a history worth keeping next to the schema. `run_cancelled`
// has been emitted for a cancelled async run since builder#481; while it was missing
// here, every cancelled run's timeline failed to parse. `source_fetch_progress` comes
// once per finished param_grid combination (builder#648), so a long fetch shows
// progress instead of going silent.
export const buildEventNameSchema = builderEnum("BuildEventName");

export const buildEventStatusSchema = builderEnum("BuildEventStatus");

/** Medallion stage (bronze/silver/gold) + export execution stage. Separate vocabulary from RunStagesResponse 3-stage. */
export const buildEventStageNameSchema = builderEnum("BuildEventStageName");

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
  /** Runs in this response — `len(runs)` after `limit`, not a total. */
  count: z.number().int().nonnegative(),
  /** Runs before `limit` (kpubdata-builder#948, contract 1.73.0); absent from an older Builder. */
  total: z.number().int().nonnegative().optional(),
});

/**
 * The Builder sign-up ledger (builder#785, contract 1.54+). An entry is an irreversible
 * id, a display name (the verified email) and the decision — the Builder stores no token
 * or credential, and anything else it might send is stripped here.
 */
export const adminUserStatusSchema = builderEnum("AdminUser.status");

export const adminUserSchema = z.object({
  /** Irreversible hash of issuer and subject — not an identity. */
  user_id: z.string(),
  display_name: z.string().nullable(),
  status: adminUserStatusSchema,
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  decided_at: z.string().nullable(),
  /** `allowlist`, or the deciding administrator's owner id. */
  decided_by: z.string().nullable(),
});

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
  count: z.number().int().nonnegative(),
});

export type AdminConfigResponse = z.infer<typeof adminConfigResponseSchema>;
export type AdminRun = z.infer<typeof adminRunSchema>;
export type AdminRunsResponse = z.infer<typeof adminRunsResponseSchema>;
export type AdminUserStatus = z.infer<typeof adminUserStatusSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

/*
 * ============================================
 * Warehouse and saved analyses (builder#797, #783; contract 1.38+)
 * ============================================
 * A deployment without a warehouse answers GET /warehouse/tables with 404
 * `warehouse_not_configured`; Studio then keeps the run-based query path.
 */

/**
 * Whether the fetch behind a snapshot collected what the provider reported (builder#816,
 * contract 1.42.0). A status this Studio does not know is kept as text and read as unknown.
 */
export const snapshotCoverageSchema = z.object({
  status: z.string(),
  reasons: z.array(z.string()),
  fetched_row_count: z.number().int().nonnegative().nullable(),
  source_reported_total: z.object({
    status: z.string(),
    value: z.number().int().nonnegative().nullable(),
    observed_at: z.string(),
  }),
});

/**
 * A table's current snapshot as `GET /warehouse/tables` summarises it (kpubdata-builder#841,
 * contract 1.47.0). A value the catalog does not have is null, never 0.
 */
export const warehouseCurrentSnapshotSchema = z.object({
  snapshot_id: z.string(),
  row_count: z.number().int().nonnegative().nullable(),
  committed_at: z.string().nullable(),
  coverage: snapshotCoverageSchema.nullable(),
});

export const warehouseTableSchema = z.object({
  table_id: z.string(),
  /** `<dataset_id>.<source_key>` — the name a query uses. */
  logical_name: z.string(),
  current_snapshot_id: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  /**
   * The current snapshot summarised (#841): absent from an older Builder (read the table's
   * detail instead), null before the first commit.
   */
  current_snapshot: warehouseCurrentSnapshotSchema.nullable().optional(),
  /**
   * The dataset the table was built for (#841): absent from an older Builder, null when
   * Builder cannot read it. Not to be derived by splitting `logical_name` when sent.
   */
  dataset_id: z.string().nullable().optional(),
});

export const warehouseTableListResponseSchema = z.object({ tables: z.array(warehouseTableSchema) });

export const warehouseSnapshotSchema = z.object({
  snapshot_id: z.string(),
  run_id: z.string(),
  state: builderEnum("WarehouseSnapshot.state"),
  row_count: z.number().int().nonnegative().nullable(),
  created_at: z.string(),
  committed_at: z.string().nullable(),
  /** Null or absent: not recorded — unknown, never complete. */
  coverage: snapshotCoverageSchema.nullable().optional(),
});

export const warehouseTableDetailResponseSchema = warehouseTableSchema.extend({
  snapshots: z.array(warehouseSnapshotSchema),
});

/**
 * A column's value range in a snapshot profile (builder#817). `trimmed` (builder#903,
 * contract 1.77.0) carries the min/max left after the profile's `range_trim` lowest and
 * highest values are removed, so one record's extreme is not disclosed; `exact` is the
 * untrimmed min/max an earlier Builder sent. Both are over finite, non-null values sent by
 * `wire_encoding`. `withheld_small_group` means fewer than `min_range_values` values
 * exist, `no_values` none, `not_applicable` a column that is neither numeric nor temporal.
 */
export const columnRangeSchema = z.object({
  status: builderEnum("ColumnRange.status"),
  min: z.json().optional(),
  max: z.json().optional(),
  wire_encoding: builderEnum("ColumnRange.wire_encoding").optional(),
  value_count: z.number().int().nonnegative().optional(),
  excluded_count: z.number().int().nonnegative().optional(),
  /** How many values the trimming removed, both ends together (1.77.0). */
  trimmed_count: z.number().int().nonnegative().optional(),
});

/**
 * One column of a snapshot profile (builder#817, #896, #897). A `withheld` column — suspected
 * personal data the BuildSpec does not accept — has only its name, types and sensitivity;
 * every statistic is null.
 */
export const columnProfileSchema = z.object({
  name: z.string(),
  storage_type: z.string(),
  logical_type: z.string(),
  time_zone: z.string().nullable(),
  sensitivity: z.object({
    /** `not_detected` is not a guarantee: only value patterns and column names are checked. */
    status: builderEnum("ColumnProfile.sensitivity.status"),
    kinds: z.array(z.string()),
  }),
  status: builderEnum("ColumnProfile.status"),
  null_count: z.number().int().nonnegative().nullable(),
  /** Null for an empty table or a withheld column — not 0. */
  null_ratio: z.number().nullable(),
  /** Float columns only; null otherwise. */
  nan_count: z.number().int().nonnegative().nullable(),
  /** Float columns only; null otherwise. */
  infinite_count: z.number().int().nonnegative().nullable(),
  range: columnRangeSchema.nullable(),
});

export const snapshotProfileSchema = z.object({
  snapshot_id: z.string(),
  artifact_digest: z.string(),
  algorithm_version: z.number().int().min(1),
  computed_at: z.string(),
  scope: z.object({
    mode: builderEnum("SnapshotProfile.scope.mode"),
    sampled: z.boolean(),
    sample_size: z.number().int().nonnegative().nullable(),
  }),
  accuracy: builderEnum("SnapshotProfile.accuracy"),
  /** A range over fewer finite values than this is withheld. */
  min_range_values: z.number().int().min(1),
  /** Values left out at each end of a range (1.77.0); absent from an earlier Builder. */
  range_trim: z.number().int().nonnegative().optional(),
  row_count: z.number().int().nonnegative(),
  columns: z.array(columnProfileSchema),
});

/** GET /warehouse/tables/{name}/profile (builder#817, contract 1.46.0): one pinned snapshot's column profile. */
export const snapshotProfileResponseSchema = z.object({
  snapshot: z.object({
    table_id: z.string(),
    logical_name: z.string(),
    snapshot_id: z.string(),
    revision: z.number().int().nonnegative(),
  }),
  profile: snapshotProfileSchema,
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

/** POST /warehouse/rows (builder#815, contract 1.43.0): one page of a pinned snapshot. */
export const warehouseRowsRequestSchema = z.object({
  table: z.string().min(1),
  /** `current` for the first page; the returned `snapshot_id` for every later one. */
  snapshot: z.string().min(1).optional(),
  offset: z.number().int().nonnegative().optional(),
  page_size: z.number().int().min(1).max(500).optional(),
  columns: z.array(z.string()).min(1).optional(),
  sort: z.array(z.object({ column: z.string(), direction: builderEnum("WarehouseRowsRequest.sort.direction").optional() })).max(8).optional(),
  /** Row filters, ANDed. With a filter, `count` defaults to `none`. */
  filters: z
    .array(
      z.object({
        column: z.string(),
        op: builderEnum("WarehouseRowsRequest.filters.op"),
        value: jsonQueryValueSchema.optional(),
        values: z.array(jsonQueryValueSchema).max(100).optional(),
      }),
    )
    .max(16)
    .optional(),
  count: builderEnum("WarehouseRowsRequest.count").optional(),
});

export const warehouseRowsResponseSchema = z.object({
  snapshot: pinnedSnapshotSchema,
  columns: z.array(z.string()),
  column_meta: z.array(columnWireInfoSchema),
  rows: z.array(z.record(z.string(), jsonQueryValueSchema)),
  order: z.array(z.object({ column: z.string(), direction: builderEnum("WarehouseRowsResponse.order.direction") })),
  page: z.object({
    offset: z.number().int().nonnegative(),
    page_size: z.number().int().positive(),
    returned: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_offset: z.number().int().nonnegative().nullable(),
  }),
  /** `not_computed` carries a null value — never read it as 0. An unknown status stays unknown. */
  count: z.object({
    status: z.union([builderEnum("WarehouseRowsResponse.count.status"), z.string()]),
    value: z.number().int().nonnegative().nullable(),
  }),
  execution_ms: z.number().int().nonnegative(),
  startup_ms: z.number().int().nonnegative(),
  engine_execution_ms: z.number().int().nonnegative(),
});

/** POST /warehouse/aggregate (builder#818, contract 1.44.0): named aggregates over a pinned snapshot. */
export const aggregateMeasureSchema = z.object({
  fn: builderEnum("WarehouseAggregateRequest.measures.fn"),
  column: z.string().optional(),
  as: z.string().optional(),
  /** Required and true for `sum`: the caller states the column may be added up. */
  additive: z.boolean().optional(),
});

export const warehouseAggregateRequestSchema = z.object({
  table: z.string().min(1),
  snapshot: z.string().min(1).optional(),
  group_by: z.array(z.string()).max(4).optional(),
  measures: z.array(aggregateMeasureSchema).min(1).max(16),
  order_by: z.array(z.object({ key: z.string(), direction: builderEnum("WarehouseAggregateRequest.order_by.direction").optional() })).max(8).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const warehouseAggregateResponseSchema = z.object({
  snapshot: pinnedSnapshotSchema,
  columns: z.array(z.string()),
  column_meta: z.array(columnWireInfoSchema),
  rows: z.array(z.record(z.string(), jsonQueryValueSchema)),
  group_by: z.array(z.string()),
  measures: z.array(
    z.object({
      as: z.string(),
      fn: z.string(),
      column: z.string().nullable(),
      additive: z.boolean().nullable(),
      unit_column: z.string().nullable(),
    }),
  ),
  order: z.array(z.object({ key: z.string(), direction: builderEnum("WarehouseAggregateResponse.order.direction") })),
  unit: z.object({ column: z.string().nullable(), policy: z.string(), check: z.string() }),
  /** Rows that passed the filters, all aggregated. `sampled` is always false today. */
  input: z.object({ row_count: z.number().int().nonnegative(), sampled: z.boolean() }),
  /** `full` — every group is here. `top_n` — the first `limit` after sorting, of `group_count`. */
  result: z.object({
    completeness: z.union([builderEnum("WarehouseAggregateResponse.result.completeness"), z.string()]),
    group_count: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  }),
  execution_ms: z.number().int().nonnegative(),
  startup_ms: z.number().int().nonnegative(),
  engine_execution_ms: z.number().int().nonnegative(),
});

/** POST /warehouse/exports (builder#819, contract 1.45.0): a pinned query's full result, policy-checked. */
export const warehouseExportRequestSchema = z.object({
  table: z.string().min(1),
  snapshot: z.string().min(1).optional(),
  sql: z.string().min(1).max(65536),
  format: builderEnum("WarehouseExportRequest.format").optional(),
  profile: builderEnum("WarehouseExportRequest.profile").optional(),
  max_rows: z.number().int().min(1).max(1_000_000).optional(),
});

export const warehouseExportManifestSchema = z.object({
  manifest_version: z.number().int(),
  export_id: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  query: z.object({ sql: z.string(), user_derived: z.boolean() }),
  /** The concrete snapshot read — never `current`. */
  snapshot: z.object({
    table_id: z.string(),
    logical_name: z.string(),
    snapshot_id: z.string(),
    revision: z.number().int().nonnegative(),
    run_id: z.string(),
    artifact_digest: z.string(),
    row_count: z.number().int().nonnegative().nullable(),
    coverage: z.record(z.string(), z.json()).nullable(),
  }),
  source: z.object({
    dataset_id: z.string().nullable(),
    terms: z.object({
      status: z.string(),
      license: z.string().nullable(),
      license_name: z.string().nullable(),
      license_link: z.string().nullable(),
      attribution: z.string().nullable(),
    }),
    provenance: z.array(z.record(z.string(), z.json())),
  }),
  output: z.object({
    format: z.string(),
    profile: z.string(),
    encoding: z.string(),
    bom: z.boolean(),
    row_count: z.number().int().nonnegative(),
    completeness: z.string(),
    columns: z.array(columnWireInfoSchema),
    values_altered: z.array(z.object({ column: z.string(), count: z.number().int().positive(), reason: z.string() })),
    file: z.object({ name: z.string(), bytes: z.number().int().nonnegative(), sha256: z.string() }),
  }),
  pii: z.object({ policy: z.string().nullable(), allowed_findings: z.array(z.record(z.string(), z.json())) }),
});

export const warehouseExportSchema = z.object({
  export_id: z.string(),
  status: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  request: z.object({
    table: z.string(),
    snapshot: z.string(),
    sql: z.string(),
    format: z.string(),
    profile: z.string(),
    max_rows: z.number().int().positive(),
  }),
  manifest: warehouseExportManifestSchema,
  bundle: z
    .object({ filename: z.string(), media_type: z.string(), bytes: z.number().int().nonnegative(), sha256: z.string(), files: z.array(z.string()) })
    .nullable(),
  download_path: z.string().nullable(),
});

export const warehouseExportListSchema = z.object({ exports: z.array(warehouseExportSchema) });
export const warehouseExportDeletedSchema = z.object({ export_id: z.string(), deleted: z.literal(true) });

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
  /**
   * Which SQL the analysis was saved in (builder#875, contract 1.75.0). Optional: an
   * older Builder does not send them. Studio reads only `migration_required` and does
   * not show the dialect or engine names (the engine is Builder's business, #565).
   */
  sql_dialect: z.string().optional(),
  engine: z.string().optional(),
  engine_version: z.string().nullable().optional(),
  query_contract_version: z.string().nullable().optional(),
  /** Saved in an earlier SQL; Builder refuses to re-run it (409 `analysis_migration_required`). */
  migration_required: z.boolean().optional(),
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
export type WarehouseCurrentSnapshot = z.infer<typeof warehouseCurrentSnapshotSchema>;
export type WarehouseTableDetailResponse = z.infer<typeof warehouseTableDetailResponseSchema>;
export type WarehouseSnapshot = z.infer<typeof warehouseSnapshotSchema>;
export type ColumnRange = z.infer<typeof columnRangeSchema>;
export type ColumnProfile = z.infer<typeof columnProfileSchema>;
export type SnapshotProfile = z.infer<typeof snapshotProfileSchema>;
export type SnapshotProfileResponse = z.infer<typeof snapshotProfileResponseSchema>;
export type WarehouseQueryRequest = z.infer<typeof warehouseQueryRequestSchema>;
export type WarehouseQueryResponse = z.infer<typeof warehouseQueryResponseSchema>;
export type WarehouseRowsRequest = z.infer<typeof warehouseRowsRequestSchema>;
export type WarehouseAggregateRequest = z.infer<typeof warehouseAggregateRequestSchema>;
export type WarehouseAggregateResponse = z.infer<typeof warehouseAggregateResponseSchema>;
export type WarehouseExportRequest = z.infer<typeof warehouseExportRequestSchema>;
export type WarehouseExport = z.infer<typeof warehouseExportSchema>;
export type WarehouseRowsResponse = z.infer<typeof warehouseRowsResponseSchema>;
export type ColumnWireInfo = z.infer<typeof columnWireInfoSchema>;
export type SavedAnalysis = z.infer<typeof savedAnalysisSchema>;
export type CreateAnalysisRequest = z.infer<typeof createAnalysisRequestSchema>;
export type CreateAnalysisResponse = z.infer<typeof createAnalysisResponseSchema>;

// --- Document revisions (kpubdata-builder#820, contract 1.59.0) ---

/** Kinds of document Builder keeps revisions of. */
export const revisionKindSchema = builderEnum("DocumentRevision.kind");

/**
 * One immutable revision (`DocumentRevision`). `author` and `created_at` are decided by
 * Builder, never sent by Studio. `content` is absent in a history listing; a spec's is
 * `{"yaml": "<BuildSpec YAML>"}`.
 */
export const documentRevisionSchema = z.object({
  kind: revisionKindSchema,
  doc_id: z.string(),
  revision: z.number().int().min(1),
  content: z.json().optional(),
  note: z.string().nullable(),
  author: z.string(),
  created_at: z.string(),
  reverted_from: z.number().int().nullable(),
});

/** `GET /revisions/{kind}/{doc_id}/history` — revisions oldest first, and the audit trail. */
export const revisionHistoryResponseSchema = z.object({
  revisions: z.array(documentRevisionSchema),
  audit: z.array(
    z.object({
      revision: z.number().int(),
      action: builderEnum("RevisionHistoryResponse.audit.action"),
      author: z.string(),
      at: z.string(),
    }),
  ),
});

/**
 * `PUT /revisions/{kind}/{doc_id}` body. Author and time are the server's, so absent here.
 * Studio only saves specs, whose content is `{"yaml": "<BuildSpec YAML>"}`.
 */
export interface SaveRevisionRequest {
  content: { yaml: string };
  expected_revision: number;
  note?: string;
  idempotency_key?: string;
}

/** `POST /revisions/{kind}/{doc_id}/revert` body. */
export interface RevertRevisionRequest {
  to_revision: number;
  expected_revision: number;
}

export type RevisionKind = z.infer<typeof revisionKindSchema>;
export type DocumentRevision = z.infer<typeof documentRevisionSchema>;
export type RevisionHistoryResponse = z.infer<typeof revisionHistoryResponseSchema>;
