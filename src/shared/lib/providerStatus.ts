/**
 * Single point for Provider status → user text conversion.
 *
 * - `describeCredentialReadiness` (current user-facing): Used by ProviderPage / Add Data
 *   instead of generic live probe for credential readiness expression. Only addresses
 *   axes reliably confirmable at Provider level (requirement / effective configured /
 *   user-saved credential presence).
 * - `describeProviderProbe` (retained): Maps Builder `ProviderTestResponse`. Generic
 *   probe calls arbitrary first Dataset without required params, so "connection success"
 *   cannot be trusted and was removed from user flow (#S-provider-probe). Builder API
 *   contract maintained, so mapping/tests retained (direct diagnostics).
 * - In either case, Preview is SSOT for actual availability of chosen Dataset.
 *
 * All wording moved to `provider.status.*` keys (#350). Fixed constants would lock
 * language at module load time, preventing language switch reflection, so interpretation
 * happens at call time.
 */
import { i18n } from "@/shared/i18n";

const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(`provider.status.${key}`, params ?? {});


export type ProviderProbeStatus =
  | "connected"
  | "failed"
  | "not_configured"
  | "not_testable"
  | "unknown";
export type ProviderProbeTone = "success" | "warning" | "error" | "neutral";

export interface ProviderProbeInput {
  /** `ProviderTestResponse.status` (`unknown` = not checked yet). */
  status: ProviderProbeStatus;
  /** `ProviderTestResponse.error_category`. */
  errorCategory?: string;
  /** `ProviderTestResponse.response_code` — actual HTTP code returned by Provider. */
  responseCode?: number;
  /**
   * whether credential is (effectively) configured for this principal.
   * With a saved credential a 403 still may be per-Dataset/API permission
   * rather than plain auth failure, so it is escalated to "needs review".
   */
  credentialConfigured?: boolean;
}

export interface ProviderProbePresentation {
  tone: ProviderProbeTone;
  /** short badge text. */
  label: string;
  /** details heading (only on connection error/needs review, else null). */
  title: string | null;
  /** user action 1-2 sentence guidance(null if missing). */
  detail: string | null;
}

function permissionCheck(): { title: string; detail: string } {
  return { title: t("permission.title"), detail: t("permission.detail") };
}

/** Builder `error_category` → message. Unknown values fall to unknown. */
const FAILURE_CATEGORIES = ["auth", "network", "timeout", "provider", "unknown"] as const;

function failure(category: string | undefined): { title: string; detail: string } {
  const key = (FAILURE_CATEGORIES as readonly string[]).includes(category ?? "")
    ? (category as string)
    : "unknown";
  return { title: t(`failure.${key}.title`), detail: t(`failure.${key}.detail`) };
}

/** always provide guidance that this is Provider-level check (distinct from Dataset availability). */
export function providerProbeScopeNote(): string {
  return t("scopeNote");
}

/**
 * Express Provider status as **credential readiness** (#S-provider-probe). Only axis
 * reliably confirmable at Provider level:
 *   - Whether provider requires credential (`requires_credential`)
 *   - Whether effective credential is configured (`configured`: user credential > server
 *     default > none, ADR 0012)
 *   - Whether this user has saved credential (GET /providers/{provider}/credential)
 *
 * "Is this API Key valid for this Dataset / Is access requested / Are required params
 * correct / Does actual response succeed" is not determined at Provider level —
 * selected Dataset's Preview is SSOT. Generic probe (`ProviderTestResponse`) not used
 * as user-facing "connection success".
 */
export interface CredentialReadinessInput {
  /** GET /providers summary `requires_credential`. */
  requiresCredential: boolean;
   /** Effective `configured` in GET /providers summary (user credential > server default > none). */
  summaryConfigured: boolean;
  /**
   * whether this user has saved credential (GET /providers/{provider}/credential
   * metadata)). Distinguished from the server default — omitted when unknown, like in the list.
   */
  userCredentialConfigured?: boolean;
}

export interface CredentialReadinessPresentation {
  tone: Exclude<ProviderProbeTone, "error">;
  /** short badge/headline text. */
  label: string;
  /** 1-2 sentence guidance. */
  detail: string;
}

/** always provide guidance that Preview is final confirmation of actual usability. */
function readinessPreviewNote(): string {
  return t("readiness.previewNote");
}

export function describeCredentialReadiness(
  input: CredentialReadinessInput,
): CredentialReadinessPresentation {
  if (!input.requiresCredential) {
    return {
      tone: "neutral",
      label: t("readiness.noAuthLabel"),
      detail: t("readiness.noAuthDetail"),
    };
  }
  if (input.userCredentialConfigured) {
    return {
      tone: "success",
      label: t("readiness.userKeyLabel"),
      detail: `${t("readiness.userKeyDetail")} ${readinessPreviewNote()}`,
    };
  }
  if (input.summaryConfigured) {
    // using server default — do not represent same as user-registered API Key.
    return {
      tone: "success",
      label: t("readiness.serverDefaultLabel"),
      detail: `${t("readiness.serverDefaultDetail")} ${readinessPreviewNote()}`,
    };
  }
  return {
    tone: "warning",
    label: t("readiness.missingKeyLabel"),
    detail: t("readiness.missingKeyDetail"),
  };
}

export function describeProviderProbe(input: ProviderProbeInput): ProviderProbePresentation {
  if (input.status === "connected") {
    return { tone: "success", label: t("probe.connected"), title: null, detail: null };
  }
  if (input.status === "not_configured") {
    return {
      tone: "neutral",
      label: t("probe.notConfigured"),
      title: t("probe.notConfiguredTitle"),
      detail: t("probe.notConfiguredDetail"),
    };
  }
  if (input.status === "unknown") {
    return { tone: "neutral", label: t("probe.unknown"), title: null, detail: null };
  }
  if (input.status === "not_testable") {
    // Builder could not pick a dataset to call without guessing (kpubdata-builder#842):
    // neither a success nor a failure of the key.
    return {
      tone: "neutral",
      label: t("probe.notTestable"),
      title: t("probe.notTestableTitle"),
      detail: t("probe.notTestableDetail"),
    };
  }
  // status === "failed"
  const needsPermissionCheck = Boolean(input.credentialConfigured) && input.responseCode === 403;
  if (needsPermissionCheck) {
    return { tone: "warning", label: t("probe.needsCheck"), ...permissionCheck() };
  }
  return { tone: "error", label: t("probe.failed"), ...failure(input.errorCategory) };
}
