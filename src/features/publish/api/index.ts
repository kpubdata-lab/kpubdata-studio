/** Connects the publish HTTP contract from Builder PR #547 into Studio's shared API layer. */
import {
  ApiError,
  type PublishCredential,
  type PublishErrorCode,
  type PublishReadinessResponse,
  type PublishRequest,
  type PublishResponse,
  type PublishTarget,
  type RedistributionVerdict,
} from "@/shared/lib/builderApi";
import { publishBlockedResponseSchema, type PublishIssue } from "@/shared/lib/builderApi.schema";
import { i18n } from "@/shared/i18n";
import { REDISTRIBUTION_ISSUE_CODES } from "../issues";
import { publishClient } from "./client";

/** All wording in this file lives under `publish.errors.*` (#350). */
const t = (key: string): string => i18n.t(`publish.errors.${key}`);

export type {
  PublishCredential,
  PublishIssue,
  PublishReadinessResponse,
  PublishRequest,
  PublishResponse,
  PublishTarget,
  PublishRedistributionRecord,
  RedistributionValue,
  RedistributionVerdict,
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

/**
 * Each of these asks the client in force (`./client`): Builder's when one is configured,
 * the demo's otherwise (#794). The demo has a readiness for each of its known runs and
 * answers 404 for any other — it never invents one (UI audit #4).
 */
export async function getPublishReadiness(
  runId: string,
  target: PublishTarget = "huggingface",
  signal?: AbortSignal,
  credential?: PublishCredential,
): Promise<PublishReadinessResponse> {
  return publishClient().readiness(runId, target, signal, credential);
}

export async function publishBuild(
  runId: string,
  request: PublishRequest,
  signal?: AbortSignal,
  credential?: PublishCredential,
): Promise<PublishResponse> {
  return publishClient().publish(runId, request, signal, credential);
}

/** What settling an unknown publish came to (#728). */
export type PublishRecoveryOutcome =
  /** The destination exists remotely: the publish did go through. */
  | { kind: "confirmed" }
  /** Nothing was found remotely and the receipt is gone: the publish may be sent again. */
  | { kind: "absent" }
  /** The receipt was deleted on request; whatever was published stays published. */
  | { kind: "reset" }
  /** No receipt to settle — nothing blocks a new publish. */
  | { kind: "nothing_to_settle" }
  /** The remote could not be read, or the outcome not saved; nothing changed. */
  | { kind: "unavailable" }
  | { kind: "failed"; message: string };

/** What a failed reconcile or reset means for the receipt (#728); read from Builder's error body. */
export function recoveryFailure(cause: unknown): PublishRecoveryOutcome {
  if (cause instanceof ApiError) {
    const code = (cause.details as { code?: unknown } | undefined)?.code;
    if (cause.status === 404 && code === "receipt_not_found") return { kind: "nothing_to_settle" };
    if (cause.status === 503) return { kind: "unavailable" };
    if (cause.status === 400 && code === "invalid_publish_credential") return { kind: "failed", message: t("invalidCredential") };
    if (cause.status === 403) return { kind: "failed", message: t("forbidden") };
    if (cause.status === 0 || cause.status === 408) return { kind: "failed", message: t("network") };
  }
  return { kind: "failed", message: t("recoveryFailed") };
}

/**
 * Ask Builder to look at the remote and settle a publish that ended
 * `publish_state_unknown` (#728). The demo has no remote and no receipts: its client
 * answers as a Builder does for a publish it has no receipt of, which reads here as
 * nothing to settle.
 */
export async function reconcilePublish(
  runId: string,
  destination: string,
  signal?: AbortSignal,
  credential?: PublishCredential,
): Promise<PublishRecoveryOutcome> {
  try {
    const response = await publishClient().reconcile(runId, { target: "huggingface", destination }, signal, credential);
    if (response.run_id !== runId) return { kind: "failed", message: t("mismatch") };
    return { kind: response.state === "succeeded" ? "confirmed" : "absent" };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return recoveryFailure(cause);
  }
}

/** Delete the receipt of an unknown publish so it can be sent again (#728). Nothing is undone remotely. */
export async function resetPublishReceipt(
  runId: string,
  destination: string,
  signal?: AbortSignal,
  credential?: PublishCredential,
): Promise<PublishRecoveryOutcome> {
  try {
    const response = await publishClient().resetReceipt(runId, "huggingface", destination, signal, credential);
    if (response.run_id !== runId) return { kind: "failed", message: t("mismatch") };
    return { kind: "reset" };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return recoveryFailure(cause);
  }
}

export type PublishFailureKind =
  | PublishErrorCode
  | "invalid_publish_credential"
  | "forbidden"
  | "not_found"
  | "network"
  | "invalid_request"
  | "readiness_changed"
  | "redistribution_blocked"
  | "unknown";

export interface PublishFailure {
  kind: PublishFailureKind;
  message: string;
  /** The blockers a refused publish's 409 named, shown with their own next steps. */
  blockers?: PublishIssue[];
  /** The request's redistribution verdict from that 409 (#688). */
  redistribution?: RedistributionVerdict | null;
}

/**
 * A blocked publish's 409 (`PublishBlockedResponse`). Every one carries `redistribution`
 * since contract 1.65.0, whatever blocked it, so the blockers' codes — not the field's
 * presence — tell a refusal by the source terms from a readiness change.
 */
function blockedFailure(cause: ApiError): PublishFailure {
  const parsed = publishBlockedResponseSchema.safeParse(cause.details);
  if (!parsed.success) return { kind: "readiness_changed", message: t("readinessChanged") };
  const { blockers, redistribution } = parsed.data;
  if (blockers.some((issue) => REDISTRIBUTION_ISSUE_CODES.has(issue.code))) {
    return { kind: "redistribution_blocked", message: t("redistributionBlocked"), blockers, redistribution };
  }
  return { kind: "readiness_changed", message: t("readinessChanged"), blockers, redistribution };
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
  if (cause.status === 409) return blockedFailure(cause);
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
