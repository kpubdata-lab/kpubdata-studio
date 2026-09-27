import { i18n } from "@/shared/i18n";
/**
 * Builder HTTP API client (#29).
 *
 * Wraps endpoints actually provided by kpubdata-builder service (`service/app.py`)
 * (`/version`, `/validate`, `/preview`, `/build`, `/artifacts/{run_id}`).
 * Defines request/response types per Builder API contract (API_CONTRACT.md / builder #209)
 * wire format, and throws abnormal responses as structured `ApiError`.
 *
 * To allow Studio operation without live Builder, default is mock and actual calls
 * are enabled only when `VITE_USE_REAL_BUILDER=true` (branched in each feature module).
 *
 * Caveat: validate/preview/build expect Builder BuildSpec YAML (snake_case), so
 * Studio BuildSpec (camelCase) → Builder spec mapping (#37) must precede full wiring.
 * This module is low-level contract layer receiving spec text after that mapping.
 *
 * Runtime type validation (#158, #103):
 * - All responses validated at runtime via Zod schema.
 * - Uses zod.parse() instead of `as T` casting to guarantee type safety.
 */
import { API_BASE } from "@/shared/config/env";
import * as schemas from "./builderApi.schema";
import { z } from "zod";

/**
 * **Minimum** Builder API version required by Studio's current integration surface
 * (async build job + cooperative cancel + manifest status/partial + provider credential +
 * monitoring + publish). Not an exact contract pin — per Builder ADR 0013, Studio treats
 * "same major, server >= this minimum" as compatible and allows higher additive
 * minor/patch (1.19~1.21 etc.) as-is.
 *
 * Cancellation (POST /builds/{id}/cancel) and manifest status/partial fields introduced
 * in Builder 1.18.0, and Studio actually uses both, so integration surface minimum is
 * 1.18.0. Unused endpoints added in 1.19~1.21 not reflected in this minimum and not
 * separately implemented in Studio.
 */
export const MIN_BUILDER_API_VERSION = "1.18.0";

/** parse into three parts `major.minor.patch`. Return null if format is invalid (fail-closed signal). */
function parseSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Determines if Builder's reported `api_version` is compatible with Studio integration surface (ADR 0013).
 *
 * Rules:
 * - server major == required major (major가 다르면 breaking — 2.0.0은 비호환)
 * - server >= required (같은 major 안에서 minor/patch가 최소값 이상)
 * - 더 높은 additive minor/patch는 호환 (1.21.0 OK)
 * - 파싱 불가/형식 오류는 fail-closed로 비호환 처리
 *
 * @param serverVersion - GET /version 응답의 `api_version`.
 * @param requiredVersion - 요구 최소 버전(기본 MIN_BUILDER_API_VERSION).
 */
export function isBuilderApiCompatible(
  serverVersion: string | undefined | null,
  requiredVersion: string = MIN_BUILDER_API_VERSION,
): boolean {
  if (!serverVersion) return false;
  const server = parseSemver(serverVersion);
  const required = parseSemver(requiredVersion);
  if (!server || !required) return false;
  if (server[0] !== required[0]) return false;
  for (let i = 0; i < 3; i++) {
    if (server[i] > required[i]) return true;
    if (server[i] < required[i]) return false;
  }
  return true;
}

/** whether to enable actual Builder calls (uses mock if not set). */
export function isRealBuilderEnabled(): boolean {
  return import.meta.env.VITE_USE_REAL_BUILDER === "true";
}

/** Structured error representing abnormal responses returned by Builder. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Auto timeout (ms). Uses DEFAULT_TIMEOUT_MS if not set. ≤0 disables timeout. */
  timeoutMs?: number;
  /** Additional retry count on network errors/5xx (exponential backoff). Uses DEFAULT_RETRIES if not set. */
  retries?: number;
  /** Omit auth header (for unauthenticated endpoints like /healthz, #186). */
  skipAuth?: boolean;
}

/**
 * Provider that supplies Bearer token to attach to Builder requests (#186).
 * null을 반환하면 해당 요청에 Authorization 헤더를 붙이지 않는다 —
 * mock 모드·미로그인 상태에서 빈 헤더가 나가는 것을 방지한다.
 *
 * OIDC 연동에서는 provider가 요청 직전 `keycloak.updateToken()`으로 만료 임박 토큰을
 * 갱신하므로 Promise를 반환할 수 있다 — apiFetch는 값을 await한 뒤 헤더를 붙인다.
 */
export type AuthTokenProvider = () => string | null | Promise<string | null>;

// Studio is a serverless static SPA, so tokens are stored only in memory (zustand store) (#187).
// apiFetch reads tokens via the injected provider — direct global reference makes testing difficult.
let authTokenProvider: AuthTokenProvider | null = null;

/**
 * Register Bearer token provider to attach to Builder requests (#186).
 * provider를 null로(또는 해제) 두면 인증 헤더가 나가지 않아, 미로그인/mock 모드에서
 * 기존 요청 형태와 완전히 동일하게 동작한다(회귀 없음).
 */
export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

/**
 * Callback to notify auth layer of 401 response (#189).
 *
 * Returning `true` means "re-auth succeeded, so retry same request with new token". 번 더 보내도 된다"는
 * 뜻이다. 그 외(`void`/`false`)는 기존과 동일하게 세션 정리만 하고 401을 그대로 던진다.
 */
export type AuthErrorCallback = () => void | boolean | Promise<void | boolean>;

let authErrorCallback: AuthErrorCallback | null = null;

export function setAuthErrorCallback(cb: AuthErrorCallback | null): void {
  authErrorCallback = cb;
}

/**
 * Notify auth layer of 401 and return whether re-auth succeeded.
 *
 * Builder 라우팅 이전의 단일 인증 게이트에서 401을 내므로(builder `_dispatch_impl`),
 * 401은 서버가 요청을 처리하기 전에 거부했다는 뜻이다 — 비멱등 POST라도 새 토큰으로
 * 한 번 더 보내는 것이 안전하다. 재인증 콜백이 던지는 예외는 원래의 401을 가리지
 * 않도록 흡수한다.
 */
async function recoverFromUnauthorized(): Promise<boolean> {
  if (!authErrorCallback) return false;
  try {
    return (await authErrorCallback()) === true;
  } catch {
    return false;
  }
}

/** Default auto timeout (ms). Builder /build calls external APIs so set generously. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Default retry count for network errors/5xx (additional count beyond initial attempt). */
export const DEFAULT_RETRIES = 2;

/** ApiError status value to identify if request was aborted by timeout. */
const TIMEOUT_STATUS = 408;

/** Create exponential backoff delay (ms) between retries. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Combine user cancel signal and timeout signal; whichever fires first aborts request.
 *
 * @param signal - Abort signal provided by caller (optional).
 * @param timeoutMs - Auto timeout (ms). If ≤0, timeout omitted and signal only used.
 * @returns Combined signal and cleanup function to clear timeout timer.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (timeoutMs <= 0) return { signal, cleanup: () => {} };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
  const cleanup = () => clearTimeout(timer);

  if (!signal) return { signal: controller.signal, cleanup };
  if (signal.aborted) {
    cleanup();
    return { signal, cleanup: () => {} };
  }
  // if user cancels, also abort timeout controller to immediately cut fetch.
  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return { signal: controller.signal, cleanup };
}

/** distinguish abort from timeout vs user cancel. */
function isTimeoutAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "TimeoutError";
}

/**
 * send one logical request — includes limited retry for network errors/timeout/5xx.
 *
 * auth header is refreshed each attempt with `authTokenProvider`에서 새로 읽는다. 401 재인증 후 재호출되면
 * 갱신된 토큰이 자연스럽게 반영된다(#189).
 */
async function fetchWithRetries(path: string, options: RequestOptions): Promise<Response> {
  const {
    method = "GET",
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
  } = options;

  let response: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { signal: combined, cleanup } = withTimeout(signal, timeoutMs);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      if (!options.skipAuth) {
        const token = (await authTokenProvider?.()) ?? null;
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      response = await fetch(`${API_BASE}${path}`, {
        method,
        signal: combined,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      cleanup();
      // if caller explicitly cancels, propagate without retry.
      if (signal?.aborted) throw cause;
      if (isTimeoutAbort(cause)) {
        if (attempt < retries) {
          await delay(500 * 2 ** attempt);
          continue;
        }
        throw new ApiError(TIMEOUT_STATUS, i18n.t("api.timeout"), cause);
      }
      // network error: retry with backoff if retries remain.
      if (attempt < retries) {
        await delay(500 * 2 ** attempt);
        continue;
      }
      throw new ApiError(0, i18n.t("api.connFail"), cause);
    }
    cleanup();

    // 5xx may be transient; limited retry. 4xx handled immediately (retry meaningless).
    if (response.status >= 500 && attempt < retries) {
      await delay(500 * 2 ** attempt);
      response = undefined;
      continue;
    }
    break;
  }

  if (!response) {
    throw new ApiError(0, i18n.t("api.connFail"));
  }

  return response;
}
/**
 * Send JSON request to Builder API and parse JSON response.
 *
 * Performs exponential backoff limited retry for network transients and 5xx (#94),
 * and applies auto timeout to prevent UI hang when response absent (#94). Respects
 * caller abort signal as-is.
 *
 * Runtime type validation (#158, #103):
 * - If schema provided, runs Zod runtime validation.
 * - Throws ApiError on validation failure.
 *
 * @param path - Endpoint path with leading slash (e.g., "/version").
 * @param options - Method/body/abort signal/timeout/retry.
 * @param schema - Zod schema to validate response (optional).
 * @returns Parsed response body.
 * @throws ApiError if response not 2xx or network/parse/timeout/schema validation error occurs.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
  schema?: z.ZodSchema<T>,
): Promise<T> {
  let response = await fetchWithRetries(path, options);

  // 401: if re-auth succeeds, send same request exactly once with new token (#189).
  // avoid exposing first failed attempt to user, limit retry to 1
  // prevent loop on real auth failure (not expiry). Don't attach auth header
  // request (skipAuth) returns same result on replay do not retry.
  if (response.status === 401) {
    const recovered = await recoverFromUnauthorized();
    if (recovered && !options.skipAuth) {
      response = await fetchWithRetries(path, options);
    }
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!response.ok) throw new ApiError(response.status, text);
      throw new ApiError(response.status, i18n.t("api.badJson"));
    }
  }

  if (!response.ok) {
    const message = formatApiErrorMessage(response.status, parsed);
    throw new ApiError(response.status, message, parsed);
  }

  // runtime type validation via Zod schema (#158, #103)
  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      // explicit error displayable to user on schema mismatch (#159)
      const errorDetails = result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `\`${issue.path.join(".")}\`` : i18n.t("api.schemaDefault");
        const message = issue.message || i18n.t("api.schemaIssueDefault");
        return `${path}: ${message}`;
      }).join(", ");

      throw new ApiError(
        500,
        i18n.t("api.schemaMismatch", { details: errorDetails }),
        parsed,
      );
    }
    return result.data;
  }

  // if no schema (backward compat): perform as T casting only
  return parsed as T;
}

/**
 * extract human-readable message from Builder abnormal response body.
 *
 * priority (maintain backward compat):
 *   1) top-level `error` 필드(있으면 그대로 사용 — builder PR이 추가 중).
 *   2) `outcomes[].error` — 실패한 소스별 사유(join). /build 502의 실제 와이어 형태.
 *
 * @param parsed - 파싱된 응답 본문(unknown).
 * @returns 추출한 metadata)시지 또는 undefined.
 */
export function extractErrorMessage(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as { error?: unknown; outcomes?: unknown };

  if (record.error != null && record.error !== "") {
    return String(record.error);
  }

  if (Array.isArray(record.outcomes)) {
    const reasons = record.outcomes
      .map((outcome) =>
        outcome && typeof outcome === "object" && "error" in outcome
          ? (outcome as { error?: unknown }).error
          : undefined,
      )
      .filter((reason): reason is string => typeof reason === "string" && reason.length > 0);
    if (reasons.length > 0) return reasons.join("; ");
  }

  return undefined;
}

/**
 * Converts HTTP status code and response body to user-displayable error message (#159).
 *
 * @param status - HTTP status code
 * @param parsed - Parsed response body
 * @returns Displayable error message for end user
 */
export function formatApiErrorMessage(status: number, parsed: unknown): string {
  // try extracting structured error message first
  const extracted = extractErrorMessage(parsed);
  if (extracted) return extracted;

  // default message by status code
  const statusMessages: Record<number, string> = {
    400: i18n.t("api.http.400"),
    401: i18n.t("api.http.401"),
    403: i18n.t("api.http.403"),
    404: i18n.t("api.http.404"),
    405: "Method Not Allowed",
    408: i18n.t("api.http.408"),
    429: i18n.t("api.http.429"),
    500: i18n.t("api.http.500"),
    502: i18n.t("api.http.502"),
    503: i18n.t("api.http.503"),
    504: "Gateway Timeout",
  };

  const baseMessage = statusMessages[status] ?? i18n.t("api.http.fallback", { status });

  // append if response has additional information
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (record.run_id) {
      return i18n.t("api.ctx.build", { base: baseMessage, id: record.run_id });
    }
    if (record.dataset_id) {
      return i18n.t("api.ctx.dataset", { base: baseMessage, id: record.dataset_id });
    }
    if (record.source_key) {
      return i18n.t("api.ctx.source", { base: baseMessage, id: record.source_key });
    }
  }

  return baseMessage;
}

/** single build summary in GET /builds response (per builder contract BuildSummary). */
export interface BuildSummary {
  /** build execution identifier */
  run_id: string;
   /**
    * Build status. Builder canonical BuildSummary vocabulary is "ok" | "failed" | "cancelled"
    * (Cancelled runs arrive as cancelled not failed — must distinguish in history/KPI).
    */
  status: "ok" | "failed" | "cancelled";
  /** build start time (ISO 8601, null, or omitted) */
  started_at?: string | null;
  /** build end time (ISO 8601, null, or omitted) */
  finished_at?: string | null;
}

/** GET /builds response wire form (per builder contract BuildsResponse). */
export interface BuildsResponse {
  builds: BuildSummary[];
}

// --- response type (extracted from Zod schema) ---

export type BuildJob = schemas.BuildJob;
export type VersionResponse = schemas.VersionResponse;
export type ValidateResponse = schemas.ValidateResponse;
export type BuildOutcome = schemas.BuildOutcome;
export type BuildResponse = schemas.BuildResponse;
export type ArtifactsResponse = schemas.ArtifactsResponse;
export type PreviewColumn = schemas.PreviewColumn;
export type PreviewSource = schemas.PreviewSource;
export type PreviewResponse = schemas.PreviewResponse;
export type CatalogQuerySupport = schemas.CatalogQuerySupport;
export type CatalogRequestParameter = schemas.CatalogRequestParameter;
export type CatalogApplication = schemas.CatalogApplication;
export type CatalogDataset = schemas.CatalogDataset;
export type CatalogProvider = schemas.CatalogProvider;
export type CatalogResponse = schemas.CatalogResponse;
export type ProviderTestResponse = schemas.ProviderTestResponse;
export type UploadMetadata = schemas.UploadMetadata;
export type ProviderSummary = schemas.ProviderSummary;
export type ProvidersResponse = schemas.ProvidersResponse;
export type ProviderCredentialResponse = schemas.ProviderCredentialResponse;
export type PreviewDiffItem = schemas.PreviewDiffItem;
export type PreviewTransformSummary = schemas.PreviewTransformSummary;
export type StageStatus = schemas.StageStatus;
export type DatasetSourceRef = schemas.DatasetSourceRef;
export type SourceStageStatus = schemas.SourceStageStatus;
export type DatasetSummary = schemas.DatasetSummary;
export type DatasetDetailResponse = schemas.DatasetDetailResponse;
export type DatasetsResponse = schemas.DatasetsResponse;
export type DatasetRunSummary = schemas.DatasetRunSummary;
export type DatasetRunsResponse = schemas.DatasetRunsResponse;
export type RunStageEntry = schemas.RunStageEntry;
export type RunStagesResponse = schemas.RunStagesResponse;
export type StageDetailResponse = schemas.StageDetailResponse;
export type QualityCheckResult = schemas.QualityCheckResult;
export type SchemaDriftFinding = schemas.SchemaDriftFinding;
export type BuildQualityResponse = schemas.BuildQualityResponse;
export type DatasetQualityHistoryEntry = schemas.DatasetQualityHistoryEntry;
export type DatasetQualityHistoryResponse = schemas.DatasetQualityHistoryResponse;
export type QualitySummaryResponse = schemas.QualitySummaryResponse;
export type QueryStage = schemas.QueryStage;
export type QueryRequest = schemas.QueryRequest;
export type QueryResponse = schemas.QueryResponse;
export type QueryErrorCode = schemas.QueryErrorCode;
export type PublishTarget = schemas.PublishTarget;
export type PublishIssue = schemas.PublishIssue;
export type PublishReadinessResponse = schemas.PublishReadinessResponse;
export type PublishHuggingFaceOptions = schemas.PublishHuggingFaceOptions;
export type PublishRequest = schemas.PublishRequest;
export type PublishResponse = schemas.PublishResponse;
export type PublishErrorCode = schemas.PublishErrorCode;
export type PublishErrorResponse = schemas.PublishErrorResponse;
export type PublishBlockedResponse = schemas.PublishBlockedResponse;
export type BuildSpecSnapshotResponse = schemas.BuildSpecSnapshotResponse;
export type BuildEventName = schemas.BuildEventName;
export type BuildEventStatus = schemas.BuildEventStatus;
export type BuildEventStageName = schemas.BuildEventStageName;
export type BuildEvent = schemas.BuildEvent;
export type BuildEventsResponse = schemas.BuildEventsResponse;

/** client wrapping Builder service endpoint. */
export const builderApi = {
  /** GET /version — contract version check (meta). */
  version: (signal?: AbortSignal) =>
    apiFetch("/version", { signal }, schemas.versionResponseSchema),

  /** POST /validate — BuildSpec YAML validation. */
  validate: (specYaml: string, signal?: AbortSignal) =>
    apiFetch("/validate", { method: "POST", body: { spec: specYaml }, signal }, schemas.validateResponseSchema),

   /**
    * POST /preview — sample preview based on BuildSpec.
    *
    * `options` per #497 sampling contract (limit 1~1000, default 5, sample_mode first/random,
    * seed) passed as-is. If omitted, returns top 5 rows same as legacy client.
    */
  preview: (
    specYaml: string,
    options?: { limit?: number; sample_mode?: "first" | "random"; seed?: number },
    signal?: AbortSignal,
  ) =>
    apiFetch(
      "/preview",
      { method: "POST", body: { spec: specYaml, ...options }, signal },
      schemas.previewResponseSchema,
    ),

  /** POST /build — execute build. run_id optional. Non-idempotent; no retry (#117). */
  build: (specYaml: string, runId?: string, signal?: AbortSignal) =>
    apiFetch(
      "/build",
      {
        method: "POST",
        body: runId ? { spec: specYaml, run_id: runId } : { spec: specYaml },
        signal,
        retries: 0,
      },
      schemas.buildResponseSchema,
    ),

  /** POST /builds — async build job submission (#245, builder #482/#480). do not retry. */
  submitBuild: (specYaml: string, runId?: string, signal?: AbortSignal) =>
    apiFetch(
      "/builds",
      {
        method: "POST",
        body: runId ? { spec: specYaml, run_id: runId } : { spec: specYaml },
        signal,
        retries: 0,
      },
      schemas.buildJobSchema,
    ),

  /** GET /builds/{run_id} — async build job status polling (#245, builder #482/#480). */
  getBuildJob: (runId: string, signal?: AbortSignal) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}`,
      { signal, retries: 1 },
      schemas.buildJobSchema,
    ),

   /**
    * POST /builds/{run_id}/cancel — Cooperative cancel request for in-progress async build job
    * (#245, builder #481). Transitions queued/running → cancelling/cancelled. Cancel is
    * non-idempotent with side effects, so do not retry. Response is latest job snapshot.
    */
  cancelBuildJob: (runId: string, signal?: AbortSignal) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/cancel`,
      { method: "POST", signal, retries: 0 },
      schemas.buildJobSchema,
    ),

  /** GET /artifacts/{runId} — list of execution artifact files. */
  artifacts: (runId: string, signal?: AbortSignal) =>
    apiFetch(`/artifacts/${encodeURIComponent(runId)}`, { signal }, schemas.artifactsResponseSchema),

  /** GET /builds/{runId}/manifest — authoritative manifest body recorded by Builder. */
  getBuildManifest: (runId: string, signal?: AbortSignal) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/manifest`,
      { signal },
      schemas.buildManifestResponseSchema,
    ),

  /** GET /builds — build history list (#153, builder #250). */
  listBuilds: (limit?: number, signal?: AbortSignal) => {
    const query = limit !== undefined ? `?limit=${limit}` : "";
    return apiFetch<BuildsResponse>(`/builds${query}`, { signal });
  },

  /** GET /catalog — provider/dataset catalog (#416, BL2). */
  catalog: (signal?: AbortSignal) =>
    apiFetch("/catalog", { signal }, schemas.catalogResponseSchema),

  /** GET /datasets — actual built dataset list. Distinct from `/catalog` source list. */
  listDatasets: (limit?: number, signal?: AbortSignal) => {
    const query = limit !== undefined ? `?limit=${limit}` : "";
    return apiFetch(`/datasets${query}`, { signal }, schemas.datasetsResponseSchema);
  },

  /** GET /datasets/{dataset_id} — dataset detail per latest accessible run. */
  getDataset: (datasetId: string, signal?: AbortSignal) =>
    apiFetch(
      `/datasets/${encodeURIComponent(datasetId)}`,
      { signal },
      schemas.datasetDetailResponseSchema,
    ),

  /** GET /datasets/{dataset_id}/runs — accessible run history of dataset. */
  listDatasetRuns: (datasetId: string, limit?: number, signal?: AbortSignal) => {
    const query = limit !== undefined ? `?limit=${limit}` : "";
    return apiFetch(
      `/datasets/${encodeURIComponent(datasetId)}/runs${query}`,
      { signal },
      schemas.datasetRunsResponseSchema,
    );
  },

  /** GET /builds/{run_id}/stages — Bronze/Silver/Gold status per source. */
  listBuildStages: (runId: string, signal?: AbortSignal) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/stages`,
      { signal },
      schemas.runStagesResponseSchema,
    ),

  /** GET /builds/{run_id}/stages/{stage} — safe details of selected source/stage. */
  getBuildStageDetail: (
    runId: string,
    stage: schemas.StageDetailResponse["stage"],
    source: string,
    limit?: number,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ source });
    if (limit !== undefined) params.set("limit", String(limit));
    return apiFetch(
      `/builds/${encodeURIComponent(runId)}/stages/${stage}?${params.toString()}`,
      { signal },
      schemas.stageDetailResponseSchema,
    );
  },

  /** GET /builds/{run_id}/quality — run-scoped quality and schema drift. */
  getBuildQuality: (runId: string, signal?: AbortSignal) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/quality`,
      { signal },
      schemas.buildQualityResponseSchema,
    ),

  /** GET /builds/{run_id}/publish/readiness — publication readiness computed by Builder. */
  getPublishReadiness: (
    runId: string,
    target: schemas.PublishTarget,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ target });
    return apiFetch(
      `/builds/${encodeURIComponent(runId)}/publish/readiness?${params.toString()}`,
      { signal, retries: 0 },
      schemas.publishReadinessResponseSchema,
    );
  },

  /** POST /builds/{run_id}/publish — remote side effect; client auto-retry forbidden. */
  publishBuild: (runId: string, request: schemas.PublishRequest, signal?: AbortSignal) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/publish`,
      { method: "POST", body: request, signal, retries: 0, timeoutMs: 0 },
      schemas.publishResponseSchema,
    ),

  /** GET /datasets/{dataset_id}/quality/history — dataset quality history. */
  getDatasetQualityHistory: (datasetId: string, limit?: number, signal?: AbortSignal) => {
    const query = limit !== undefined ? `?limit=${limit}` : "";
    return apiFetch(
      `/datasets/${encodeURIComponent(datasetId)}/quality/history${query}`,
      { signal },
      schemas.datasetQualityHistoryResponseSchema,
    );
  },

   /**
    * POST /query — Execute read-only SQL on server-resolved Silver/Gold table (#504, 1.7.0).
    *
    * Builder rejects Bronze (Studio also preemptively blocks at UI layer, `features/kubi/query.ts`).
    * SQL should only be called when user explicitly chooses to execute; do not retry automatically
    * (429/504 already signal saturation/timeout, so retry worsens situation).
    */
   query: (request: schemas.QueryRequest, signal?: AbortSignal) =>
     apiFetch(
       "/query",
       { method: "POST", body: request, signal, retries: 0 },
       schemas.queryResponseSchema,
     ),

  /**
   * GET /monitoring/summary — Builder API/Queue/Workers/Artifact Store system
   * 상태 요약 (#516). 개인 데이터는 포함하지 않는다.
   */
  getMonitoringSummary: (signal?: AbortSignal) =>
    apiFetch(
      "/monitoring/summary",
      { signal },
      schemas.monitoringSummaryResponseSchema,
    ),

  /**
   * GET /monitoring/builds — 24-hour hourly build stats and recent runs (#516).
   * ENFORCE_OWNERSHIP에서는 요청 principal이 접근 가능한 run만 집계된다.
   */
  getMonitoringBuilds: (signal?: AbortSignal) =>
    apiFetch(
      "/monitoring/builds?window=24h&bucket=hour",
      { signal },
      schemas.monitoringBuildsResponseSchema,
    ),

  /**
   * GET /quality/summary — recent 24h cross-run quality aggregate (Builder 1.22.0, #486 후속).
   * Home "QUALITY WARN (24H)" KPI가 이 값을 authoritative하게 읽는다. 1.21.0 이하
   * Builder에서는 404이므로 호출부가 이 KPI만 독립적으로 "확인 불가" 처리한다 —
   * 다른 KPI/Recent Builds는 영향받지 않는다.
   */
  getQualitySummary: (signal?: AbortSignal) =>
    apiFetch(
      "/quality/summary?window=24h",
      { signal },
      schemas.qualitySummaryResponseSchema,
    ),

  /**
   * POST /providers/{provider}/test — lightweight with current principal credential
   * connection test 실행 (#492). Add Data의 Public API 단계에서 "연결 테스트"
   * 버튼이 호출한다. credential 값 자체는 Studio가 주고받지 않는다 — Builder가
   * 서버에 저장된 credential(또는 무인증 provider)로 직접 검사한다.
   */
   /**
    * GET /providers — Runtime Provider list and current principal's configured status (#492).
    * Response contains only boolean summary — credential text does not exist anywhere.
    */
  listProviders: (signal?: AbortSignal) =>
    apiFetch(
      "/providers",
      { signal },
      schemas.providersResponseSchema,
    ),

  testProviderConnection: (provider: string, signal?: AbortSignal) =>
    apiFetch(
      `/providers/${encodeURIComponent(provider)}/test`,
      { method: "POST", signal, retries: 0 },
      schemas.providerTestResponseSchema,
    ),

   /**
    * GET /providers/{provider}/status — Lightweight connection check using server-stored
    * credential (or unauthenticated provider) (#259, builder provider credentials API).
    * Credential text not exchanged. Response shape common with POST /providers/{provider}/test.
    */
  getProviderStatus: (provider: string, signal?: AbortSignal) =>
    apiFetch(
      `/providers/${encodeURIComponent(provider)}/status`,
      { signal, retries: 1 },
      schemas.providerTestResponseSchema,
    ),

  /**
   * GET /providers/{provider}/credential — credential saved by current principal
   * metadata)(#259, ADR 0012). `{ configured, masked, updated_at }`만 반환하며 raw
   * secret은 포함하지 않는다. GET /providers 요약의 `configured`(effective provider
   * configuration)와 달리 이 `configured`는 "이 사용자가 직접 저장한 credential이
   * 있는지"만 뜻한다.
   */
  getProviderCredential: (provider: string, signal?: AbortSignal) =>
    apiFetch(
      `/providers/${encodeURIComponent(provider)}/credential`,
      { signal, retries: 1 },
      schemas.providerCredentialResponseSchema,
    ),

   /**
    * PUT /providers/{provider}/credential — Register/replace raw credential (#259).
    * Body contains only `{ credential }`, and response contains no plaintext (Studio
    * also does not save/log/echo). Non-idempotent side effect, so do not retry.
    */
  putProviderCredential: (provider: string, credential: string, signal?: AbortSignal) =>
    apiFetch<unknown>(
      `/providers/${encodeURIComponent(provider)}/credential`,
      { method: "PUT", body: { credential }, signal, retries: 0 },
    ),

  /** DELETE /providers/{provider}/credential — remove saved credential (#259). */
  deleteProviderCredential: (provider: string, signal?: AbortSignal) =>
    apiFetch<unknown>(
      `/providers/${encodeURIComponent(provider)}/credential`,
      { method: "DELETE", signal, retries: 0 },
    ),

  /**
   * GET /builds/{run_id}/spec — canonical (redacted) BuildSpec snapshot used for executionot (#487).
   *
   * legacy run(snapshot 없음)은 404다 — Studio는 이를 "정보 없음"이 아니라
   * "snapshot unavailable"로 구분해서 표시해야 한다.
   */
  getBuildSpecSnapshot: (runId: string, signal?: AbortSignal) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/spec`,
      { signal },
      schemas.buildSpecSnapshotResponseSchema,
    ),

  /**
   * GET /builds/{run_id}/events — append-only structured run event timeline (#496).
   *
   * `tail: true`면 최신 `limit`개를 고르되 반환은 항상 chronological ascending이다.
   */
  getBuildEvents: (
    runId: string,
    options?: { limit?: number; tail?: boolean },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.tail !== undefined) params.set("tail", String(options.tail));
    const query = params.toString();
    return apiFetch(
      `/builds/${encodeURIComponent(runId)}/events${query ? `?${query}` : ""}`,
      { signal },
      schemas.buildEventsResponseSchema,
    );
  },

  // uploadFile sends raw body (not JSON), so uses separate function instead of apiFetch
  // defined below (function hoisting allows reference here).
  uploadFile,
  // downloadArtifactFile is also separate function since response is binary, doesn't use apiFetch.
  downloadArtifactFile,
};

/**
 * POST /uploads — file upload for kind="file" source (#498).
 *
 * request body is not JSON but raw bytes(`application/octet-stream`)라 `apiFetch`의
 * JSON-only 경로를 재사용할 수 없다. 인증/재시도/타임아웃 관례는 최대한 맞추되
 * (Bearer 헤더는 authTokenProvider를 그대로 사용), 비멱등 업로드이므로 네트워크
 * 오류·5xx에는 do not retry. 401은 예외다 — Builder가 라우팅 전 인증 게이트에서
 * 거부한 것이라 업로드가 수행되지 않았고, 재인증에 성공하면 한 번만 다시 보낸다(#189).
 * `format`/`encoding`/`filename`은 query parameter로 보낸다.
 */
export async function uploadFile(
  bytes: Blob | ArrayBuffer,
  options: { format: "csv" | "json" | "jsonl" | "parquet"; encoding?: string; filename?: string },
  signal?: AbortSignal,
): Promise<schemas.UploadMetadata> {
  const params = new URLSearchParams({ format: options.format });
  if (options.encoding) params.set("encoding", options.encoding);
  if (options.filename) params.set("filename", options.filename);

  async function send(): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    const token = (await authTokenProvider?.()) ?? null;
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetch(`${API_BASE}/uploads?${params.toString()}`, {
        method: "POST",
        headers,
        body: bytes,
        signal,
      });
    } catch (cause) {
      throw new ApiError(0, i18n.t("api.connFail"), cause);
    }
  }

  let response = await send();
  if (response.status === 401 && (await recoverFromUnauthorized())) {
    response = await send();
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(response.status, i18n.t("api.badJson"));
  }

  if (!response.ok) {
    throw new ApiError(response.status, formatApiErrorMessage(response.status, parsed), parsed);
  }

  const result = schemas.uploadMetadataSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(500, i18n.t("api.uploadMismatch"), parsed);
  }
  return result.data;
}

/** safely extract filename from Content-Disposition header (null if missing). Remove path separators. */
function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  const raw = star?.[1] ?? plain?.[1];
  if (!raw) return null;
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* use unencoded value as-is */
  }
  // discard directory component, keep filename only.
  return value.split(/[\\/]/).pop() || null;
}

/**
 * GET /artifacts/{run_id}/{file_path} — Receive individual execution artifact file via
 * authenticated request.
 *
 * Response is binary file, not JSON, so cannot use `apiFetch` JSON path. Bearer header
 * reused from `authTokenProvider` same as `uploadFile`, and on 401 retries auth via
 * same `authErrorCallback`, fetching again once if auth succeeds (#189).
 *
 * `filePath` must be canonical run-relative POSIX path from Builder `GET /artifacts/{run_id}`
 * list (e.g., "silver/datago.air_quality/table.parquet"). manifest.outputs is output_root
 * absolute path + OS separator, so cannot be passed here. Keep "/" separator as-is, only
 * URL-encode each segment — encoding "/" as "%2F"/"%5C" or similar does not change path
 * meaning (traversal Builder rejects after decode and re-validation).
 */
export async function downloadArtifactFile(
  runId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const encodedPath = filePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  async function send(): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = (await authTokenProvider?.()) ?? null;
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetch(`${API_BASE}/artifacts/${encodeURIComponent(runId)}/${encodedPath}`, {
        method: "GET",
        headers,
        signal,
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw new ApiError(0, i18n.t("api.connFail"), cause);
    }
  }

  let response = await send();
  if (response.status === 401 && (await recoverFromUnauthorized())) {
    response = await send();
  }

  if (!response.ok) {
    let parsed: unknown;
    try {
      const text = await response.text();
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    throw new ApiError(response.status, formatApiErrorMessage(response.status, parsed), parsed);
  }

  const blob = await response.blob();
  const filename =
    filenameFromContentDisposition(response.headers.get("Content-Disposition")) ??
    filePath.split("/").pop() ??
    "artifact";
  return { blob, filename };
}
