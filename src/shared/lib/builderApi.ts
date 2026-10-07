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
import { runtimeOr } from "@/shared/config/runtime";
import * as schemas from "./builderApi.schema";
import { noteKeyProviders, providerKeyHeaders, specProviders } from "./providerKeys";
import { clearSessionRefusal, isSessionRefused, noteSessionRefused } from "./sessionRefusal";
import { noteSignupBlock } from "./signupStatus";
import { z } from "zod";

/**
 * **Minimum** Builder API contract version Studio's client needs (#725). Not an exact
 * pin — per Builder ADR 0013, "same major, server >= this minimum" is compatible and a
 * higher additive minor/patch is accepted as-is.
 *
 * It is measured, not remembered: 1.59.0 is the first contract version that declares
 * every route `builderApi` calls — the newest are the revision routes
 * (`/revisions/{kind}/{doc_id}`, its `/history` and `/revert`, builder#820). Before it
 * came `/admin/users` (1.54.0), the snapshot profile (1.46.0) and the warehouse exports
 * (1.45.0). Studio's response schemas parse every contract-valid response from there up.
 * Raise it when the client starts calling a route, or requiring a field, that a later
 * contract introduced.
 *
 * Below it some screens cannot work at all, so the app says so on every page
 * (`VersionMismatchBanner`), and Settings repeats it next to the connection.
 */
export const MIN_BUILDER_API_VERSION = "1.59.0";

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
 * - server major == required major (if major differs, breaking — 2.0.0 incompatible)
 * - server >= required (within same major, minor/patch must meet minimum)
 * - higher additive minor/patch compatible (1.21.0 OK)
 * - parse failure/format error treated as incompatible (fail-closed)
 *
 * @param serverVersion - `api_version` from GET /version response.
 * @param requiredVersion - minimum required version (default MIN_BUILDER_API_VERSION).
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
  return runtimeOr("useRealBuilder", import.meta.env.VITE_USE_REAL_BUILDER) === "true";
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

/**
 * Builder answered, but not in the form Studio reads it with (#791): a body that is not
 * JSON, or JSON its contract schema rejects. It used to be thrown as `ApiError(500)`,
 * which read as a server failure — retried as an undecided save, counted with real 5xx —
 * and carried the whole response body as `details`, so the body (rows, names, anything
 * the endpoint returns) reached the console through the error boundaries.
 *
 * `status` is the HTTP status Builder actually sent (2xx for a successful request whose
 * body did not match). `code` says which mismatch it was, and `paths` names the fields
 * the schema rejected — never their values. `details` is left empty: it is where callers
 * look for Builder's own error body, and this is not one.
 */
export class ContractMismatchError extends ApiError {
  constructor(
    status: number,
    message: string,
    readonly code: "bad_json" | "schema_mismatch",
    readonly paths: readonly string[] = [],
  ) {
    super(status, message);
    this.name = "ContractMismatchError";
  }
}

/** The fields a schema rejected, as dotted paths ("" for the body itself). No values. */
function rejectedPaths(issues: readonly { path: readonly PropertyKey[] }[]): string[] {
  return [...new Set(issues.map((issue) => issue.path.map(String).join(".")))];
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
  /**
   * Extra request headers for this request only. Never logged and never part of an
   * error: a request-scoped credential (`X-Publish-Credential`, #615; `X-Provider-Key`,
   * #652) travels here.
   */
  headers?: Record<string, string>;
}

/**
 * Provider that supplies Bearer token to attach to Builder requests (#186).
 * Returning null omits Authorization header — prevents empty header in mock mode/logged-out
 * state.
 *
 * OIDC integration: provider can return Promise since it calls `keycloak.updateToken()`
 * before request — apiFetch awaits the value before attaching header.
 */
export type AuthTokenProvider = () => string | null | Promise<string | null>;

// Studio is a serverless static SPA, so tokens are stored only in memory (zustand store) (#187).
// apiFetch reads tokens via the injected provider — direct global reference makes testing difficult.
let authTokenProvider: AuthTokenProvider | null = null;

/**
 * Register Bearer token provider to attach to Builder requests (#186).
 * Omitting auth header (for unauthenticated endpoints like /healthz, #186) operates
 * identically to old request behavior (no regression).
 */
export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

/**
 * Callback to notify auth layer of 401 response (#189).
 *
 * Returning `true` means "re-auth succeeded, retry same request with new token".
 * Otherwise (`void`/`false`): clean up session and throw original 401.
 */
export type AuthErrorCallback = () => void | boolean | Promise<void | boolean>;

let authErrorCallback: AuthErrorCallback | null = null;

export function setAuthErrorCallback(cb: AuthErrorCallback | null): void {
  authErrorCallback = cb;
}

/**
 * Notify auth layer of 401 and return whether re-auth succeeded.
 *
 * 401 comes from single auth gate before Builder routing (`builder _dispatch_impl`), so
 * 401 means server rejected before processing — safe to retry non-idempotent POST with
 * new token. Exceptions from re-auth callback are caught to not mask original 401.
 */
async function recoverFromUnauthorized(): Promise<boolean> {
  // A refusal that stands is not cured by renewing again (#771) — on any request path.
  if (!authErrorCallback || isSessionRefused()) return false;
  // The queries of one screen meet the same 401 together; they share one renewal rather
  // than each forcing its own.
  recovery ??= Promise.resolve()
    .then(() => authErrorCallback?.())
    .then(
      (result) => result === true,
      () => false,
    )
    .then((renewed) => {
      if (renewed) lastRenewedAt = Date.now();
      return renewed;
    })
    .finally(() => {
      recovery = null;
    });
  return recovery;
}

let recovery: Promise<boolean> | null = null;
/** When the token was last renewed after a 401; null until that happens. */
let lastRenewedAt: number | null = null;
/**
 * A token this fresh has not expired. A 401 for a request sent with it is Builder
 * refusing the session, not asking for another renewal.
 *
 * Ten seconds is a value chosen here, not one Builder or the identity provider gives. An
 * access token that lives for less than this would have its ordinary expiry taken for a
 * refusal; token lifetimes are minutes, so the two do not meet in practice.
 */
const FRESH_TOKEN_MS = 10_000;

/** Test helper: forget that a token was renewed. */
export function resetAuthRenewalForTests(): void {
  recovery = null;
  lastRenewedAt = null;
}

/** Default auto timeout (ms). Builder /build calls external APIs so set generously. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Builder's profiling timeout is 60 s (builder#896); Studio waits a little longer for its answer. */
export const PROFILE_TIMEOUT_MS = 75_000;
/**
 * A key probe can take about 60 s: Builder stops starting calls after 45 s, and the call
 * it started last may run for 15 s more (builder#802). Cut off at the default 30 s, the
 * probe went on running in Builder and pressing again met its rate limit (#768).
 */
export const PROBE_TIMEOUT_MS = 75_000;

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
 * Send one logical request — includes limited retry for network errors/timeout/5xx.
 *
 * Auth header refreshed each attempt via `authTokenProvider`. After 401 re-auth and
 * retry, updated token naturally reflected (#189).
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
    const headers: Record<string, string> = { ...options.headers, "Content-Type": "application/json" };
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
  const sentAt = Date.now();
  let response = await fetchWithRetries(path, options);

  // 401: if re-auth succeeds, send same request exactly once with new token (#189).
  // avoid exposing first failed attempt to user, limit retry to 1
  // prevent loop on real auth failure (not expiry). Don't attach auth header
  // request (skipAuth) returns same result on replay do not retry.
  //
  // A renewed token that is refused too is not an expiry (#771): the refusal is recorded
  // once and, while it stands, a 401 is neither renewed nor resent — at most one resend
  // per refusal, whatever the number of queries on the screen.
  let refusedWithFreshToken = false;
  if (response.status === 401 && !isSessionRefused() && !options.skipAuth) {
    if (lastRenewedAt !== null && sentAt >= lastRenewedAt && sentAt - lastRenewedAt < FRESH_TOKEN_MS) {
      // Sent with a token renewed a moment ago: renewing again changes nothing.
      refusedWithFreshToken = true;
    } else if (lastRenewedAt !== null && sentAt < lastRenewedAt) {
      // Another query renewed the token while this one was out: use that one.
      response = await fetchWithRetries(path, options);
      refusedWithFreshToken = response.status === 401;
    } else if (await recoverFromUnauthorized()) {
      response = await fetchWithRetries(path, options);
      refusedWithFreshToken = response.status === 401;
    }
  } else if (response.status === 401 && !isSessionRefused()) {
    // A request that carries no token gets the same answer again; the auth layer is
    // still told, as before.
    await recoverFromUnauthorized();
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!response.ok) throw new ApiError(response.status, text);
      throw new ContractMismatchError(response.status, i18n.t("api.badJson"), "bad_json");
    }
  }

  if (refusedWithFreshToken && response.status === 401) noteSessionRefused(parsed);
  // An accepted request with the session's token means the refusal is over.
  if (response.ok && !options.skipAuth) clearSessionRefusal();
  if (!response.ok) throw httpError(response.status, parsed);

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

      throw new ContractMismatchError(
        response.status,
        i18n.t("api.schemaMismatch", { details: errorDetails }),
        "schema_mismatch",
        rejectedPaths(result.error.issues),
      );
    }
    return result.data;
  }

  // if no schema (backward compat): perform as T casting only
  return parsed as T;
}

/**
 * The error for one non-2xx Builder response — every request path builds it here, so a
 * sign-up ledger refusal (403 `signup_pending`/`signup_rejected`, #658) is recorded once
 * for the app shell whichever call met it first. Exported so the contract drift check can
 * read Builder's error examples through the same path (#701).
 */
export function httpError(status: number, parsed: unknown): ApiError {
  noteSignupBlock(status, parsed);
  return new ApiError(status, formatApiErrorMessage(status, parsed), parsed);
}

/**
 * Extract human-readable message from Builder abnormal response body.
 *
 * Priority (maintain backward compat):
 *   1) top-level `error` field (if present, use as-is — builder PR adding).
 *   2) `outcomes[].error` — per-source failure reason (joined). actual /build 502 wire format.
 *
 * @param parsed - parsed response body (unknown).
 * @returns extracted message or undefined.
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

/**
 * One run in GET /builds (contract BuildSummary). Status is "ok" | "failed" | "cancelled" —
 * a cancelled run is not a failed one. The table and snapshot fields come from
 * kpubdata-builder#844 and are absent from an older Builder.
 */
export type BuildSummary = schemas.BuildSummary;

/** GET /builds response wire form (contract BuildsResponse). */
export type BuildsResponse = schemas.BuildsResponse;

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
export type ProviderProbeResponse = schemas.ProviderProbeResponse;
export type UploadMetadata = schemas.UploadMetadata;
export type ProviderSummary = schemas.ProviderSummary;
export type ProviderLastTest = schemas.ProviderLastTest;
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
export type DatasetRunResponse = schemas.DatasetRunResponse;
export type RunStageEntry = schemas.RunStageEntry;
export type RunStagesResponse = schemas.RunStagesResponse;
export type StageDetailResponse = schemas.StageDetailResponse;
export type QualityCheckResult = schemas.QualityCheckResult;
export type SchemaDriftFinding = schemas.SchemaDriftFinding;
export type BuildQualityResponse = schemas.BuildQualityResponse;
export type DatasetQualityHistoryEntry = schemas.DatasetQualityHistoryEntry;
export type DatasetQualityHistoryResponse = schemas.DatasetQualityHistoryResponse;
export type QualitySummaryResponse = schemas.QualitySummaryResponse;
export type QualityIssue = schemas.QualityIssue;
export type QualityIssuesCoverage = schemas.QualityIssuesCoverage;
export type QualityIssuesResponse = schemas.QualityIssuesResponse;
export type QueryStage = schemas.QueryStage;
export type QueryRequest = schemas.QueryRequest;
export type QueryResponse = schemas.QueryResponse;
export type AdminConfigResponse = schemas.AdminConfigResponse;
export type WarehouseTable = schemas.WarehouseTable;
export type WarehouseCurrentSnapshot = schemas.WarehouseCurrentSnapshot;
export type WarehouseSnapshot = schemas.WarehouseSnapshot;
export type ColumnProfile = schemas.ColumnProfile;
export type SnapshotProfileResponse = schemas.SnapshotProfileResponse;
export type WarehouseQueryResponse = schemas.WarehouseQueryResponse;
export type WarehouseRowsRequest = schemas.WarehouseRowsRequest;
export type WarehouseExportRequest = schemas.WarehouseExportRequest;
export type WarehouseExport = schemas.WarehouseExport;
export type WarehouseRowsResponse = schemas.WarehouseRowsResponse;
export type ColumnWireInfo = schemas.ColumnWireInfo;
export type WarehouseAggregateRequest = schemas.WarehouseAggregateRequest;
export type WarehouseAggregateResponse = schemas.WarehouseAggregateResponse;
export type SavedAnalysis = schemas.SavedAnalysis;
export type AdminRun = schemas.AdminRun;
export type AdminRunsResponse = schemas.AdminRunsResponse;
export type AdminUserStatus = schemas.AdminUserStatus;
export type AdminUser = schemas.AdminUser;
export type AdminUsersResponse = schemas.AdminUsersResponse;
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
export type RedistributionValue = schemas.RedistributionValue;
export type RedistributionVerdict = schemas.RedistributionVerdict;
export type PublishRedistributionRecord = schemas.PublishRedistributionRecord;
export type BuildSpecSnapshotResponse = schemas.BuildSpecSnapshotResponse;
export type BuildEventName = schemas.BuildEventName;
export type BuildEventStatus = schemas.BuildEventStatus;
export type BuildEventStageName = schemas.BuildEventStageName;
export type BuildEvent = schemas.BuildEvent;
export type BuildEventsResponse = schemas.BuildEventsResponse;
export type RevisionKind = schemas.RevisionKind;
export type DocumentRevision = schemas.DocumentRevision;
export type RevisionHistoryResponse = schemas.RevisionHistoryResponse;
export type SaveRevisionRequest = schemas.SaveRevisionRequest;
export type RevertRevisionRequest = schemas.RevertRevisionRequest;

/**
 * Request header carrying the requester's own publish credential (kpubdata-builder#925,
 * contract 1.67.0): `<VARIABLE>=<value>`, the same form as `X-Provider-Key`. A multi-user
 * Builder publishes only with this header; a single-user Builder ignores it.
 */
export const PUBLISH_CREDENTIAL_HEADER = "X-Publish-Credential";

/**
 * A publish credential held in memory for one request (#615). Studio publishes only to
 * Hugging Face, so only `HF_TOKEN` is modelled; Kaggle's pair is not a Studio target.
 */
export interface PublishCredential {
  HF_TOKEN: string;
}

/** The `X-Publish-Credential` header for `credential`, or no header when it is empty. */
export function publishCredentialHeaders(
  credential: PublishCredential | undefined,
): Record<string, string> {
  const token = credential?.HF_TOKEN.trim();
  return token ? { [PUBLISH_CREDENTIAL_HEADER]: `HF_TOKEN=${token}` } : {};
}

/**
 * Client wrapping Builder service endpoints.
 *
 * Provider keys held for this page load (`providerKeys`, #652) ride in `X-Provider-Key`
 * on exactly the calls that build a provider client — `/preview`, `/build`, `/builds`,
 * `/providers/{provider}/test` and `/status` — and on no other route. Nothing is held in a
 * single-user deployment, so those calls send no such header there.
 */
/**
 * The body of `POST /build` and `POST /builds`. `retry_of` names the earlier run this
 * build retries (builder#1042, contract 1.85.0): a run id is one attempt, so a retry is a
 * new run that points back. Each optional field is sent only when it has a value.
 */
function buildRequestBody(specYaml: string, runId?: string, retryOf?: string) {
  return {
    spec: specYaml,
    ...(runId ? { run_id: runId } : {}),
    ...(retryOf ? { retry_of: retryOf } : {}),
  };
}

export const builderApi = {
  /** GET /warehouse/tables — the caller's committed tables; 404 when there is no warehouse (builder#797). */
  listWarehouseTables: (signal?: AbortSignal) =>
    apiFetch("/warehouse/tables", { signal, retries: 0 }, schemas.warehouseTableListResponseSchema),

  /** GET /warehouse/tables/{name} — one table and its readable snapshots, newest first. */
  getWarehouseTable: (name: string, signal?: AbortSignal) =>
    apiFetch(`/warehouse/tables/${encodeURIComponent(name)}`, { signal }, schemas.warehouseTableDetailResponseSchema),

  /**
   * GET /warehouse/tables/{name}/profile — the column profile of one snapshot (builder#817).
   * Pass a concrete snapshot id: the profile must describe the snapshot on screen. Not
   * retried: a 504 is remembered by Builder for 5 minutes, and a retry would only repeat it.
   * Profiling has its own 60-second limit (builder#896), so Studio waits past it for Builder's
   * own answer instead of giving up first.
   */
  getWarehouseTableProfile: (name: string, snapshot: string, signal?: AbortSignal) =>
    apiFetch(
      `/warehouse/tables/${encodeURIComponent(name)}/profile?${new URLSearchParams({ snapshot })}`,
      { signal, retries: 0, timeoutMs: PROFILE_TIMEOUT_MS },
      schemas.snapshotProfileResponseSchema,
    ),

  /** POST /warehouse/query — read-only SQL against a snapshot pinned at query start. */
  warehouseQuery: (request: schemas.WarehouseQueryRequest, signal?: AbortSignal) =>
    apiFetch("/warehouse/query", { method: "POST", body: request, signal, retries: 0 }, schemas.warehouseQueryResponseSchema),

  /** POST /warehouse/rows — one page of a pinned snapshot (builder#815). Pass the returned snapshot id on. */
  warehouseRows: (request: schemas.WarehouseRowsRequest, signal?: AbortSignal) =>
    apiFetch("/warehouse/rows", { method: "POST", body: request, signal, retries: 0 }, schemas.warehouseRowsResponseSchema),

  /** POST /warehouse/aggregate — named aggregates over a pinned snapshot, top N only after the whole aggregate (builder#818). */
  warehouseAggregate: (request: schemas.WarehouseAggregateRequest, signal?: AbortSignal) =>
    apiFetch("/warehouse/aggregate", { method: "POST", body: request, signal, retries: 0 }, schemas.warehouseAggregateResponseSchema),
  /**
   * POST /warehouse/exports — Builder runs the query on a pinned snapshot, checks licence
   * and PII policy and keeps the complete result as a bundle (builder#819). Studio never
   * builds a result file itself (#501).
   */
  createWarehouseExport: (request: schemas.WarehouseExportRequest, signal?: AbortSignal) =>
    apiFetch("/warehouse/exports", { method: "POST", body: request, signal, retries: 0 }, schemas.warehouseExportSchema),

  /** GET /warehouse/exports — the caller's unexpired exports, newest first. */
  listWarehouseExports: (signal?: AbortSignal) =>
    apiFetch("/warehouse/exports", { signal }, schemas.warehouseExportListSchema),

  /** DELETE /warehouse/exports/{id} — delete an export and its file. */
  deleteWarehouseExport: (exportId: string, signal?: AbortSignal) =>
    apiFetch(`/warehouse/exports/${encodeURIComponent(exportId)}`, { method: "DELETE", signal, retries: 0 }, schemas.warehouseExportDeletedSchema),

  // downloadWarehouseExport is binary too; see below.
  downloadWarehouseExport,

  /** GET /analyses — the caller's saved analyses, newest first (builder#783). */
  listAnalyses: (signal?: AbortSignal) => apiFetch("/analyses", { signal }, schemas.analysisListResponseSchema),

  /** POST /analyses — run the query once and save it bound to the snapshot it read. */
  createAnalysis: (request: schemas.CreateAnalysisRequest, signal?: AbortSignal) =>
    apiFetch("/analyses", { method: "POST", body: request, signal, retries: 0 }, schemas.createAnalysisResponseSchema),

  /** POST /analyses/{id}/run — re-run against the stored snapshot, not the current one. */
  runAnalysis: (analysisId: string, signal?: AbortSignal) =>
    apiFetch(
      `/analyses/${encodeURIComponent(analysisId)}/run`,
      { method: "POST", signal, retries: 0 },
      schemas.warehouseQueryResponseSchema,
    ),

  /** DELETE /analyses/{id} — delete it and release its snapshot hold. */
  deleteAnalysis: (analysisId: string, signal?: AbortSignal) =>
    apiFetch(`/analyses/${encodeURIComponent(analysisId)}`, { method: "DELETE", signal }, schemas.analysisDeletedResponseSchema),

  /** GET /admin/config — live policy state; 403 for anyone but an administrator (builder#679). */
  adminConfig: (signal?: AbortSignal) =>
    apiFetch("/admin/config", { signal, retries: 0 }, schemas.adminConfigResponseSchema),

  /** GET /admin/runs — every owner's runs, metadata only (builder#679). */
  adminRuns: (limit = 50, signal?: AbortSignal) =>
    apiFetch(`/admin/runs?limit=${limit}`, { signal }, schemas.adminRunsResponseSchema),

  /** GET /admin/users — the sign-up ledger, newest first; no credential (builder#785). */
  adminUsers: (status?: schemas.AdminUserStatus, signal?: AbortSignal) =>
    apiFetch(
      status ? `/admin/users?status=${status}` : "/admin/users",
      { signal },
      schemas.adminUsersResponseSchema,
    ),

  /** POST /admin/users/{id}/approve — mark a sign-up approved; 403 for a non-administrator. */
  adminApproveUser: (userId: string, signal?: AbortSignal) =>
    apiFetch(
      `/admin/users/${encodeURIComponent(userId)}/approve`,
      { method: "POST", signal, retries: 0 },
      schemas.adminUserSchema,
    ),

  /** POST /admin/users/{id}/reject — mark a sign-up rejected; 403 for a non-administrator. */
  adminRejectUser: (userId: string, signal?: AbortSignal) =>
    apiFetch(
      `/admin/users/${encodeURIComponent(userId)}/reject`,
      { method: "POST", signal, retries: 0 },
      schemas.adminUserSchema,
    ),

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
    *
    * Not retried (#724): a preview calls the provider with the user's key, so a retry on
    * a 5xx, a timeout or a dropped connection spent the user's daily quota up to three
    * times for one click. A failure is shown, and the user decides whether to ask again.
    */
  preview: (
    specYaml: string,
    options?: { limit?: number; sample_mode?: "first" | "random"; seed?: number },
    signal?: AbortSignal,
  ) =>
    apiFetch(
      "/preview",
      { method: "POST", body: { spec: specYaml, ...options }, signal, retries: 0, headers: providerKeyHeaders(specProviders(specYaml)) },
      schemas.previewResponseSchema,
    ),

  /**
   * POST /build — execute build. run_id optional. Non-idempotent; no retry (#117).
   *
   * No client timeout (#723): the call returns when the build ends, and a build of an
   * uploaded file — which only this synchronous route runs — can take longer than the
   * default 30 s. Timing out reported a 408 for a build that was still running, and a
   * second click started the same build again. The caller's `signal` still cancels it.
   */
  build: (specYaml: string, runId?: string, signal?: AbortSignal, retryOf?: string) =>
    apiFetch(
      "/build",
      {
        method: "POST",
        body: buildRequestBody(specYaml, runId, retryOf),
        signal,
        retries: 0,
        timeoutMs: 0,
        headers: providerKeyHeaders(specProviders(specYaml)),
      },
      schemas.buildResponseSchema,
    ),

  /**
   * GET /uploads/{upload_id} — an upload's metadata (#758): whether it is still there and
   * until when it is kept. Not retried: a 404 is the answer for an upload Builder deleted.
   */
  getUpload: (uploadId: string, signal?: AbortSignal) =>
    apiFetch(`/uploads/${encodeURIComponent(uploadId)}`, { signal, retries: 0 }, schemas.uploadMetadataSchema),

  /**
   * GET /uploads — the signed-in user's uploads, metadata only, newest first (#779,
   * builder#1067, contract 1.96.0). An upload past its retention date is not listed.
   */
  listUploads: (signal?: AbortSignal) => apiFetch("/uploads", { signal, retries: 0 }, schemas.uploadListSchema),

  /** DELETE /uploads/{upload_id} — delete one of the signed-in user's uploads (#779). */
  deleteUpload: (uploadId: string, signal?: AbortSignal) =>
    apiFetch<unknown>(`/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE", signal, retries: 0 }),

  /** POST /builds — async build job submission (#245, builder #482/#480). do not retry. */
  submitBuild: (specYaml: string, runId?: string, signal?: AbortSignal, retryOf?: string) =>
    apiFetch(
      "/builds",
      {
        method: "POST",
        body: buildRequestBody(specYaml, runId, retryOf),
        signal,
        retries: 0,
        headers: providerKeyHeaders(specProviders(specYaml)),
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
    return apiFetch(`/builds${query}`, { signal }, schemas.buildsResponseSchema);
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

  /**
   * GET /datasets/{dataset_id}/runs/{run_id} — one run by id, beyond the newest page (#418).
   * Builder decides membership and ownership: 404 not in this dataset, 403 not the caller's.
   */
  getDatasetRun: (datasetId: string, runId: string, signal?: AbortSignal) =>
    apiFetch(
      `/datasets/${encodeURIComponent(datasetId)}/runs/${encodeURIComponent(runId)}`,
      { signal },
      schemas.datasetRunResponseSchema,
    ),

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

  /**
   * GET /builds/{run_id}/publish/readiness — publication readiness computed by Builder.
   * `credential` is sent in `X-Publish-Credential`, never in the URL (#615).
   */
  getPublishReadiness: (
    runId: string,
    target: schemas.PublishTarget,
    signal?: AbortSignal,
    credential?: PublishCredential,
  ) => {
    const params = new URLSearchParams({ target });
    return apiFetch(
      `/builds/${encodeURIComponent(runId)}/publish/readiness?${params.toString()}`,
      { signal, retries: 0, headers: publishCredentialHeaders(credential) },
      schemas.publishReadinessResponseSchema,
    );
  },

  /**
   * POST /builds/{run_id}/publish — remote side effect; client auto-retry forbidden.
   * `credential` is sent in `X-Publish-Credential`, never in the body (#615).
   */
  publishBuild: (
    runId: string,
    request: schemas.PublishRequest,
    signal?: AbortSignal,
    credential?: PublishCredential,
  ) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/publish`,
      {
        method: "POST",
        body: request,
        signal,
        retries: 0,
        timeoutMs: 0,
        headers: publishCredentialHeaders(credential),
      },
      schemas.publishResponseSchema,
    ),

  /**
   * POST /builds/{run_id}/publish/reconcile — settle a publish whose outcome was not
   * learnt (`publish_state_unknown`) by looking at the remote (#728). Not retried: it
   * reads the remote with the requester's credential.
   */
  reconcilePublish: (
    runId: string,
    request: { target: schemas.PublishTarget; destination: string },
    signal?: AbortSignal,
    credential?: PublishCredential,
  ) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/publish/reconcile`,
      { method: "POST", body: request, signal, retries: 0, headers: publishCredentialHeaders(credential) },
      schemas.publishReconcileResponseSchema,
    ),

  /**
   * DELETE /builds/{run_id}/publish/receipt — delete the caller's receipt so the same
   * publish can be claimed again (#728). Nothing is undone remotely.
   */
  resetPublishReceipt: (
    runId: string,
    target: schemas.PublishTarget,
    destination: string,
    signal?: AbortSignal,
    credential?: PublishCredential,
  ) => {
    const params = new URLSearchParams({ target, destination });
    return apiFetch(
      `/builds/${encodeURIComponent(runId)}/publish/receipt?${params.toString()}`,
      { method: "DELETE", signal, retries: 0, headers: publishCredentialHeaders(credential) },
      schemas.publishReceiptResetSchema,
    );
  },

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
    * Builder rejects Bronze (Studio also preemptively blocks at UI layer, `features/assistant/query.ts`).
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
    * status summary (#516). Does not include personal data.
    */
  getMonitoringSummary: (signal?: AbortSignal) =>
    apiFetch(
      "/monitoring/summary",
      { signal },
      schemas.monitoringSummaryResponseSchema,
    ),

   /**
    * GET /monitoring/builds — 24-hour hourly build stats and recent runs (#516).
    * Under ENFORCE_OWNERSHIP, only runs accessible to request principal are aggregated.
    */
  getMonitoringBuilds: (signal?: AbortSignal) =>
    apiFetch(
      "/monitoring/builds?window=24h&bucket=hour",
      { signal },
      schemas.monitoringBuildsResponseSchema,
    ),

   /**
    * GET /quality/summary — recent 24h cross-run quality aggregate (Builder 1.22.0, #486 follow-up).
    * Home "QUALITY WARN (24H)" KPI reads this authoritatively. In Builder 1.21.0 and earlier,
    * 404 returned, so caller handles only this KPI independently as "unavailable" — other
    * KPIs/Recent Builds unaffected.
    */
  getQualitySummary: (signal?: AbortSignal) =>
    apiFetch(
      "/quality/summary?window=24h",
      { signal },
      schemas.qualitySummaryResponseSchema,
    ),

  /**
   * GET /quality/issues — WARN/FAIL checks and schema drift from every visible table's
   * latest run, failures first, in one call (kpubdata-builder#843, contract 1.49.0).
   * `coverage` counts tables evaluated, not evaluated, partial and unreadable. A Builder
   * before 1.49.0 answers 404.
   */
  listQualityIssues: (
    query: { datasetId?: string; limit?: number; cursor?: string } = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (query.datasetId) params.set("dataset_id", query.datasetId);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.cursor) params.set("cursor", query.cursor);
    const search = params.toString();
    return apiFetch(
      `/quality/issues${search ? `?${search}` : ""}`,
      { signal },
      schemas.qualityIssuesResponseSchema,
    );
  },

   /**
    * GET /providers — Runtime Provider list and current principal's configured status (#492).
    * Response contains only boolean summary — credential text does not exist anywhere.
    *
    * Carries the held provider keys (contract 1.90.0). In a multi-user deployment the
    * request is the only place a key lives, so Builder can only report a provider as
    * configured when it sees the key — without the header every keyed provider reads
    * `false` and Add Data blocks a user who holds a key. Builder also decides which held
    * key covers a provider (`localdata` uses `datago`'s), so Studio sends what it holds
    * rather than guessing. The route calls no provider.
    */
  listProviders: (signal?: AbortSignal) =>
    apiFetch(
      "/providers",
      { signal, headers: providerKeyHeaders() },
      schemas.providersResponseSchema,
    ).then((response) => {
      // Whose key each provider calls with is Builder's to say (kpubdata-builder#1085).
      noteKeyProviders(response.providers);
      return response;
    }),

   /**
    * POST /providers/{provider}/test — connection test with the current principal's
    * credential (#492). Since kpubdata-builder#842 it calls a dataset that needs no guessed
    * parameter and no application, answers `not_testable` when there is none, and is
    * remembered as `last_test` in GET /providers. Credential text is not exchanged.
    */
  testProviderConnection: (provider: string, signal?: AbortSignal) =>
    apiFetch(
      `/providers/${encodeURIComponent(provider)}/test`,
      { method: "POST", signal, retries: 0, headers: providerKeyHeaders([provider]) },
      schemas.providerTestResponseSchema,
    ),

   /**
    * POST /providers/{provider}/probe — what the key held for this session reaches, per
    * dataset (#410, kpubdata-builder#802, contract 1.87.0). Builder uses only the key in
    * `X-Provider-Key` and stores neither it nor the result. One upstream call per dataset,
    * so it is never retried here.
    */
  probeProviderKey: (provider: string, signal?: AbortSignal) =>
    apiFetch(
      `/providers/${encodeURIComponent(provider)}/probe`,
      { method: "POST", signal, retries: 0, timeoutMs: PROBE_TIMEOUT_MS, headers: providerKeyHeaders([provider]) },
      schemas.providerProbeResponseSchema,
    ),

   /**
    * GET /providers/{provider}/status — a light connection check with the key this
    * request carries (#259; a single-user Builder uses its stored or environment key).
    * Response shape common with POST /providers/{provider}/test.
    *
    * Never retried here (#792): Builder calls the provider to answer, with the user's
    * key in a multi-user deployment, so a retry after a timeout or a 5xx is a second call
    * on their quota for one click — and the first may have reached the provider. The
    * same rule as the test, the probe and the preview.
    */
  getProviderStatus: (provider: string, signal?: AbortSignal) =>
    apiFetch(
      `/providers/${encodeURIComponent(provider)}/status`,
      { signal, retries: 0, headers: providerKeyHeaders([provider]) },
      schemas.providerTestResponseSchema,
    ),

   /**
    * GET /providers/{provider}/credential — credential saved by current principal
    * metadata (#259, ADR 0012). Returns only `{ configured, masked, updated_at }`;
    * raw secret not included. Unlike `configured` in GET /providers summary (effective
    * provider configuration), this `configured` means only "does this user have directly
    * saved credential".
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
    * GET /builds/{run_id}/spec — canonical (redacted) BuildSpec snapshot used for execution (#487).
    *
    * Legacy run (no snapshot) returns 404 — Studio must distinguish this as
    * "snapshot unavailable", not "no info".
    */
  getBuildSpecSnapshot: (runId: string, signal?: AbortSignal) =>
    apiFetch(
      `/builds/${encodeURIComponent(runId)}/spec`,
      { signal },
      schemas.buildSpecSnapshotResponseSchema,
    ),

  /**
   * PUT /revisions/{kind}/{doc_id} — save a document as a new immutable revision (builder#820).
   *
   * 409 `revision_conflict` (with `current_revision`) when another save came first; 400
   * `credential_in_content` when the content carries a credential. The automatic retry on
   * a network error or 5xx is safe because the body carries the same `idempotency_key`:
   * Builder answers a repeat with the revision the first attempt made.
   */
  saveRevision: (
    kind: schemas.RevisionKind,
    docId: string,
    request: schemas.SaveRevisionRequest,
    signal?: AbortSignal,
  ) =>
    apiFetch(
      `/revisions/${kind}/${encodeURIComponent(docId)}`,
      { method: "PUT", body: request, signal },
      schemas.documentRevisionSchema,
    ),

  /** GET /revisions/{kind}/{doc_id} — the latest revision; 404 when the document has none. */
  getRevision: (kind: schemas.RevisionKind, docId: string, signal?: AbortSignal) =>
    apiFetch(
      `/revisions/${kind}/${encodeURIComponent(docId)}`,
      { signal },
      schemas.documentRevisionSchema,
    ),

  /** GET /revisions/{kind}/{doc_id}/history — every revision (no content) and the audit trail. */
  getRevisionHistory: (kind: schemas.RevisionKind, docId: string, signal?: AbortSignal) =>
    apiFetch(
      `/revisions/${kind}/${encodeURIComponent(docId)}/history`,
      { signal },
      schemas.revisionHistoryResponseSchema,
    ),

  /**
   * POST /revisions/{kind}/{doc_id}/revert — a new revision with an old one's content.
   * Not retried: the request has no idempotency key, so a repeat after a lost answer
   * would only meet a conflict with its own first attempt.
   */
  revertRevision: (
    kind: schemas.RevisionKind,
    docId: string,
    request: schemas.RevertRevisionRequest,
    signal?: AbortSignal,
  ) =>
    apiFetch(
      `/revisions/${kind}/${encodeURIComponent(docId)}/revert`,
      { method: "POST", body: request, signal, retries: 0 },
      schemas.documentRevisionSchema,
    ),

   /**
    * GET /builds/{run_id}/events — append-only structured run event timeline (#496).
    *
    * If `tail: true`, selects latest `limit` items, but return is always chronological ascending.
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
 * Request body is not JSON but raw bytes (`application/octet-stream`), so can't reuse
 * apiFetch's JSON-only path. Auth/retry/timeout conventions matched as much as possible
 * (Bearer header uses authTokenProvider directly), but upload is non-idempotent so
 * do not retry on network errors/5xx. 401 is exception — Builder rejects at auth gate
 * before routing, so upload didn't occur; if re-auth succeeds, retry once (#189).
 * `format`/`encoding`/`filename` sent as query parameters.
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
    if (!response.ok) throw new ApiError(response.status, i18n.t("api.badJson"));
    throw new ContractMismatchError(response.status, i18n.t("api.badJson"), "bad_json");
  }

  if (!response.ok) {
    throw httpError(response.status, parsed);
  }

  const result = schemas.uploadMetadataSchema.safeParse(parsed);
  if (!result.success) {
    throw new ContractMismatchError(
      response.status,
      i18n.t("api.uploadMismatch"),
      "schema_mismatch",
      rejectedPaths(result.error.issues),
    );
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
/**
 * GET an export's bundle (builder#819) — the zip Builder wrote, with the caller's own
 * credentials, so ownership and expiry are checked by Builder at download time.
 */
export async function downloadWarehouseExport(
  exportId: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  return fetchBinary(`/warehouse/exports/${encodeURIComponent(exportId)}/download`, `${exportId}.zip`, signal);
}

/** GET a binary Builder resource with the Bearer token, retrying once after re-auth (#189). */
async function fetchBinary(path: string, fallbackName: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  async function send(): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = (await authTokenProvider?.()) ?? null;
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetch(`${API_BASE}${path}`, { method: "GET", headers, signal });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw new ApiError(0, i18n.t("api.connFail"), cause);
    }
  }
  let response = await send();
  if (response.status === 401 && (await recoverFromUnauthorized())) response = await send();
  if (!response.ok) {
    let parsed: unknown;
    try {
      const text = await response.text();
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    throw httpError(response.status, parsed);
  }
  const blob = await response.blob();
  return { blob, filename: filenameFromContentDisposition(response.headers.get("Content-Disposition")) ?? fallbackName };
}

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
    throw httpError(response.status, parsed);
  }

  const blob = await response.blob();
  const filename =
    filenameFromContentDisposition(response.headers.get("Content-Disposition")) ??
    filePath.split("/").pop() ??
    "artifact";
  return { blob, filename };
}
