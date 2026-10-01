/** Connects the publish HTTP contract from Builder PR #547 into Studio's shared API layer. */
import {
  ApiError,
  builderApi,
  isRealBuilderEnabled,
  type PublishCredential,
  type PublishErrorCode,
  type PublishReadinessResponse,
  type PublishRequest,
  type PublishResponse,
  type PublishTarget,
} from "@/shared/lib/builderApi";
import { i18n } from "@/shared/i18n";
import { MOCK_PUBLISH_READINESS, mockPublishResult } from "./mockData";

/** All wording in this file lives under `publish.errors.*` (#350). */
const t = (key: string): string => i18n.t(`publish.errors.${key}`);

export type {
  PublishCredential,
  PublishIssue,
  PublishReadinessResponse,
  PublishRequest,
  PublishResponse,
  PublishTarget,
} from "@/shared/lib/builderApi";

const HUGGING_FACE_DESTINATION =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function validatePublishDestination(destination: string): string | undefined {
  if (!destination.trim()) return t("destinationRequired");
  if (!HUGGING_FACE_DESTINATION.test(destination)) {
    return t("destinationFormat");
  }
  return undefined;
}

/**
 * A token `X-Publish-Credential` can carry: visible ASCII without a comma, which the
 * header uses to separate values. Anything else is refused here, before a request, so a
 * malformed token is neither sent nor echoed (#615).
 */
const PUBLISH_TOKEN = /^[\x21-\x2B\x2D-\x7E]+$/;

/**
 * Checks a publish token typed into the page. Empty is valid — no header is sent. The
 * message never contains the token.
 */
export function validatePublishToken(token: string): string | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  return PUBLISH_TOKEN.test(trimmed) ? undefined : t("invalidCredential");
}

/** The credential to send for `token`, or undefined when there is nothing to send. */
export function publishCredentialFor(token: string): PublishCredential | undefined {
  const trimmed = token.trim();
  if (!trimmed || validatePublishToken(trimmed)) return undefined;
  return { HF_TOKEN: trimmed };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

/**
 * Branches mock/real the same way as the other Builder endpoints
 * (getDataset/listBuildStages etc. in `features/datasets/api`) — previously
 * this branch did not exist, so mock mode always hit the real Builder
 * server; in local/demo environments (Builder not running) that request
 * always failed and the readiness card was effectively always empty (UI
 * audit #4). A mock run_id with no Builder is treated as 404, never
 * invented.
 */
export async function getPublishReadiness(
  runId: string,
  target: PublishTarget = "huggingface",
  signal?: AbortSignal,
  credential?: PublishCredential,
): Promise<PublishReadinessResponse> {
  if (isRealBuilderEnabled()) return builderApi.getPublishReadiness(runId, target, signal, credential);
  throwIfAborted(signal);
  const mock = MOCK_PUBLISH_READINESS[runId];
  if (!mock) throw new ApiError(404, t("readinessNotFound"));
  return mock;
}

export async function publishBuild(
  runId: string,
  request: PublishRequest,
  signal?: AbortSignal,
  credential?: PublishCredential,
): Promise<PublishResponse> {
  if (isRealBuilderEnabled()) return builderApi.publishBuild(runId, request, signal, credential);
  throwIfAborted(signal);
  const readiness = MOCK_PUBLISH_READINESS[runId];
  if (!readiness) throw new ApiError(404, t("runNotFound"));
  if (!readiness.ready || readiness.blockers.length > 0) {
    throw new ApiError(409, t("notReady"), { code: "publish_conflict" });
  }
  return mockPublishResult(runId, request.destination, request.options?.private ?? true);
}

export type PublishFailureKind = PublishErrorCode | "invalid_publish_credential" | "forbidden" | "not_found" | "network" | "invalid_request" | "readiness_changed" | "unknown";

export interface PublishFailure {
  kind: PublishFailureKind;
  message: string;
}

function errorCode(cause: ApiError): PublishErrorCode | undefined {
  if (!cause.details || typeof cause.details !== "object") return undefined;
  const code = (cause.details as { code?: unknown }).code;
  if (
    code === "unsupported_target" ||
    code === "publish_in_progress" ||
    code === "publish_state_unknown" ||
    code === "publish_conflict" ||
    code === "publish_failed"
  ) return code;
  return undefined;
}

/** Translates only stable status/codes — never echoes server plaintext/HTML/secrets to the screen. */
export function describePublishFailure(cause: unknown): PublishFailure {
  if (!(cause instanceof ApiError)) {
    return { kind: "unknown", message: t("unknown") };
  }

  // Builder never echoes the value (builder#925), and neither does this message.
  if (cause.status === 400 && (cause.details as { code?: unknown } | undefined)?.code === "invalid_publish_credential") {
    return { kind: "invalid_publish_credential", message: t("invalidCredential") };
  }
  const code = errorCode(cause);
  if (code === "publish_in_progress") {
    return { kind: code, message: t("inProgress") };
  }
  if (code === "publish_state_unknown") {
    return { kind: code, message: t("retryBlocked") };
  }
  if (code === "publish_conflict") {
    return { kind: code, message: t("visibilityConflict") };
  }
  if (code === "publish_failed" || cause.status === 502) {
    return { kind: code ?? "unknown", message: t("externalFailed") };
  }
  if (cause.status === 409) return { kind: "readiness_changed", message: t("readinessChanged") };
  if (cause.status === 403) return { kind: "forbidden", message: t("forbidden") };
  if (cause.status === 404) return { kind: "not_found", message: t("notFound") };
  if (cause.status === 0 || cause.status === 408) return { kind: "network", message: t("network") };
  if (cause.status === 400 || code === "unsupported_target") return { kind: code ?? "invalid_request", message: t("invalidRequest") };
  return { kind: "unknown", message: t("incomplete") };
}

export function isSafePublishReference(reference: string): boolean {
  try {
    const url = new URL(reference);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
