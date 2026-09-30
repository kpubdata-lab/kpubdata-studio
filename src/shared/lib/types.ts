/**
 * define domain types and state models shared globally in Studio.
 *
 * spec, execution results exchanged between Builder and Studio, and publication state in one consistent set of types.
 */
/** status value indicating which stage draft being edited is in */
export type DraftStatus = "new" | "dirty" | "validated" | "invalid";

/** value indicating which state build execution passes from queue to completion */
export type BuildRunStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

/** status value expressing which stage final publication flow is in */
export type PublishStatus =
  | "not_started"
  | "ready"
  | "publishing"
  | "published"
  | "publish_failed";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface BuildSpec {
  /** dataset identifier commonly used across Studio and Builder dataset identifier */
  datasetId: string;
  /** human-readable build title */
  title: string;
  /** sentence explaining build purpose and context */
  description: string;
  /** list of actual source data providers */
  sources: SourceRef[];
  /** list of export targets defining artifact format */
  exports: ExportTarget[];
  /** metadata key-value dict for reuse in subsequent stages */
  metadata: Record<string, JsonValue>;
  /**
   * preserve canonical top-level fields not directly modeled by Studio form/YAML editor
   * as-is (#250). A Builder BuildSpec allows fields Studio does not yet edit
   * — `publish`/`splits`/`pii`/`license`/`quality`/`composition` — with
   * `additionalProperties: true`. When present, `toBuilderSpec` spreads
   * this first and overwrites with known fields so nothing is lost in the
   * round-trip as long as the GUI does not touch it.
   */
  extra?: Record<string, JsonValue>;
}

/** kind="public_api" (default) / file / url distinction(#498). */
export type SourceKind = "public_api" | "file" | "url";

/** Formats actually supported by kind="file"/"url" source (per Builder #498 contract). */
export type SourceFormat = "csv" | "json" | "jsonl" | "parquet";

export interface SchemaContract {
  /** list of required column names (Builder validate_table required_columns). */
  required: string[];
  /** expected dtype string per column (Builder _NAMED_DTYPES key). */
  dtypes: Record<string, string>;
  /** per-column casting to apply during normalization (Builder normalize_table casts). */
  casts: Record<string, string>;
}

export interface SourceRef {
  /**
   * source kind (#498, #250). If omitted, Builder interprets as "public_api"
   * ((backward compat — existing specs/tests work without kind).
   */
  kind?: SourceKind;
  /** provider adapter name. Required for kind="public_api". */
  provider?: string;
  /** dataset name or code within provider. Required for kind="public_api". */
  dataset?: string;
  params: Record<string, JsonValue>;
  /** alias for distinguishing when same provider/dataset used multiple times */
  alias?: string;
  /** source schema contract (VAL-1). If undefined, skip Silver validation (backward compat). */
  schema?: SchemaContract;
  /** required for kind="file". Identifier issued by `POST /uploads` (`upl_` + 32 hex chars). */
  uploadId?: string;
   /**
    * Source content format. Required for kind="file" (must match validated format on upload).
    * For kind="url", optional (json/jsonl/csv only; inferred from Content-Type if omitted).
    */
  format?: SourceFormat;
  /** encoding for text (csv/json/jsonl) decoding in kind="file". Default utf-8. */
  encoding?: string;
  /** required for kind="url". HTTPS only (SSRF policy, #498). */
  endpoint?: string;
  /** used only in kind="url"; P0 allows GET only. */
  method?: "GET";
}

export interface ExportTarget {
  /** identifier determining export format for artifacts */
  format: string;
  /** set of additional options needed only for specific export format */
  options?: Record<string, JsonValue>;
}

/** single column information in manifest schema summary (Builder schema_summary.py FieldSummary). */
export interface ManifestFieldSummary {
  /** column name */
  name: string;
  /** string representation of column type */
  type: string;
  /** whether column can contain null values */
  nullable: boolean;
}

/** schema summary per source (artifact) (Builder schema_summary.py SchemaSummary). */
export interface ManifestSchemaSummary {
  /** field summary list preserving column order */
  fields: ManifestFieldSummary[];
  /** column count (same as fields length) */
  total_fields: number;
}

/** detailed provenance per source (Builder provenance.py SourceProvenance). */
export interface ManifestSourceProvenance {
  /** data provider identifier (e.g., datago) */
  provider: string;
  /** dataset identifier */
  dataset: string;
  /** fetch completion time (UTC ISO 8601 string) */
  fetched_at: string;
  /** number of fetched records */
  record_count: number;
  /** reproducible checksum of data ("sha256:..." format) */
  data_checksum: string;
  /** source API version. "unknown" if unavailable */
  api_version: string;
  /** snapshot of fetch request parameters */
  params: Record<string, unknown>;
}

/** snapshot of execution environment that created build (Builder environment.py BuildEnvironment). */
export interface ManifestBuildEnvironment {
  /** Python version that executed build */
  python_version: string;
  /** installed kpubdata version. "unknown" if unavailable */
  kpubdata_version: string;
  /** installed kpubdata-builder version. "unknown" if unavailable */
  builder_version: string;
}

/**
 * type aligned 1:1 with wire form of manifest JSON that Builder writes to disk (#98).
 *
 * Follows Builder `manifest/writer.py`'s serialization payload verbatim
 * (snake_case). The previous camelCase/single-total (recordCount)/SourceRef[]
 * shape differed from real Builder output and broke mapping. This type
 * lets the UI use the rich information Builder returns (provenance/schema/
 * environment/fingerprint) as-is.
 */
export interface BuildManifest {
  /** manifest serialization format version (semver, Builder MANIFEST_SCHEMA_VERSION) */
  schema_version: string;
  /** unique ID tracking executed build */
  build_id: string;
  /** build start time ISO string (UTC). undefined if not provided */
  started_at?: string;
  /** build completion time ISO string (UTC). undefined if not provided */
  finished_at?: string;
  /** execution environment that created build. null if not captured */
  build_environment?: ManifestBuildEnvironment | null;
  /** list of input files or source identifiers. undefined if not provided */
  inputs?: string[];
  /** reproducibility fingerprint of all input data ("sha256:..."). null if no input */
  inputs_fingerprint?: string | null;
  /** list of generated artifact paths. undefined if not provided */
  outputs?: string[];
  /** list of non-fatal warnings requiring attention. undefined if not provided */
  warnings?: string[];
  /** list of execution failure or partial failure messages. undefined if not provided */
  errors?: string[];
  /** record count summary by stage or artifact (source key → count). undefined if not provided */
  row_counts?: Record<string, number>;
  /** schema summary by source (artifact) key. Uses same keys as row_counts. undefined if not provided */
  schema_summaries?: Record<string, ManifestSchemaSummary>;
  /** list of detailed provenance per source (fetch time/params/record count/checksum). undefined if not provided */
  provenance?: ManifestSourceProvenance[];
  /** preserve manifest fields that Builder provides additively without loss. */
}

export interface BuildDraft {
  /** current spec body being edited by user */
  spec: BuildSpec;
  /** draft status value indicating edit/validation state */
  status: DraftStatus;
  /** last modified time ISO string */
  lastModified: string;
}

export interface BuildRun {
  /** unique ID of execution history item */
  id: string;
  /** build spec used for execution */
  spec: BuildSpec;
  /** current execution state */
  status: BuildRunStatus;
  /** manifest information to be generated after execution completes */
  manifest?: BuildManifest;
  /** execution start time ISO string */
  startedAt: string;
  /** execution end time ISO string */
  finishedAt?: string;
  /** failure/cancellation reason (only in terminal state of failed/partially failed job) */
  error?: string;
}

/**
 * minimal representation type for build history list(#153).
 *
 * Builder GET /builds provides no spec/title, so those are null and the UI
 * shows the run ID instead. Entering a detail screen that needs the real
 * BuildSpec fetches the full spec individually at that point.
 */
export interface BuildListItem {
  /** unique ID of execution history item */
  id: string;
  /** build title (null on real run since Builder doesn't provide, actual title on mock) */
  title: string | null;
  /** current execution state */
  status: BuildRunStatus;
  /** execution start time ISO string(keep null if null from Builder) */
  startedAt: string | null;
  /** execution end time ISO string (null if null or omitted by Builder) */
  finishedAt: string | null;
  /**
   * The table (dataset id) the run refreshed (kpubdata-builder#844). `undefined` when the
   * Builder does not send it, `null` when it could not read it.
   */
  datasetId?: string | null;
  /**
   * The one warehouse snapshot the run committed (#844). `undefined` when not sent, `null`
   * when it committed none or several (see `snapshots`).
   */
  snapshotId?: string | null;
  /** Every snapshot the run committed that still exists, by table (#844). */
  snapshots?: { logicalName: string; snapshotId: string }[];
}
