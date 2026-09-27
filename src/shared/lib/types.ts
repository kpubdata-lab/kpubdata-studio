/**
 * define domain types and state models shared globally in Studio.
 *
 * spec, execution results exchanged between Builder and Studio, 게시 상태를 일관된 타입으로 표현한다.
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
   * as-is(#250). Builder BuildSpec은 `publish`/`splits`/`pii`/`license`/`quality`/
   * `composition` 등 Studio가 아직 편집 UI를 제공하지 않는 필드를 허용하며,
   * `additionalProperties: true`다. 이 값이 있으면 GUI가 손대지 않는 한 round-trip
   * 중 유실되지 않도록 `toBuilderSpec`이 이 값을 먼저 펼치고 알려진 필드로 덮어쓴다.
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
   * ((backward compat — existing spec/테스트가 kind 없이도 그대로 동작).
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
   * source content format. Required for kind="file" (must match validated format on upload
   * 함), kind="url"에서는 선택(json/jsonl/csv만 허용, 생략 시 Content-Type로 추론).
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
 * Builder `manifest/writer.py`의 직렬화 payload를 그대로 따른다(snake_case). 기존의
 * camelCase·단일 합계(recordCount)·SourceRef[] 형태는 실제 Builder 출력과 달라 매핑이
 * 깨졌었다. 이 타입은 Builder가 반환하는 풍부한 정보(provenance/schema/환경/지문)를
 * UI가 그대로 활용할 수 있게 한다.
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
 * Builder GET /builds doesn't provide spec/title, so을 null로 가지고
 * UI에서는 run ID를 대신 표시한다. 실제 BuildSpec이 필요한 상세 화면으로 진입하면
 * 그때 개별 조회로 전체 스펙을 가져온다.
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
}
