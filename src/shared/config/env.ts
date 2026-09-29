/**
 * Defines the default API endpoint Studio uses to communicate with the Builder backend.
 *
 * If an environment variable is set, the deployment environment value takes precedence;
 * otherwise, falls back to the local development default.
 */
import { i18n } from "@/shared/i18n";

import { runtimeOr } from "./runtime";

export const API_BASE =
  runtimeOr("builderApiUrl", import.meta.env.VITE_BUILDER_API_URL) ?? "http://localhost:8000";

/** Development-only real-Builder authentication bypass policy. */
export function resolveDevAuthBypass({ dev, bypass }: { dev: boolean; bypass?: string }): boolean {
  return dev && bypass === "true";
}

/** Returns whether the local development authentication bypass is enabled. */
export function isDevAuthBypassEnabled(): boolean {
  return resolveDevAuthBypass({
    dev: import.meta.env.DEV,
    bypass: import.meta.env.VITE_DEV_BYPASS_AUTH,
  });
}

/**
 * OIDC (Keycloak) integration configuration (ADR 0015).
 *
 * Studio is a public SPA — the frontend does not include a client secret.
 * Only issuer/clientId are included in the bundle as public values.
 */
export interface OidcConfig {
  /** The full issuer URL (e.g., http://localhost:8080/realms/kpubdata). */
  issuer: string;
  /** The Keycloak base URL required by the keycloak-js `url` option (e.g., http://localhost:8080). */
  authServerUrl: string;
  /** The realm name (e.g., kpubdata). */
  realm: string;
  /** public SPA client id. */
  clientId: string;
}

export type OidcConfigResult =
  | { status: "disabled" }
  | { status: "ok"; config: OidcConfig }
  | { status: "error"; reason: string };

/**
 * Decomposes an issuer URL into the base URL + realm required by keycloak-js.
 *
 * Only accepts the form `http(s)://<host>[/prefix]/realms/<realm>`. Returns `null` if
 * the format is invalid, so the caller can handle with fail-closed semantics.
 */
export function parseOidcIssuer(
  issuer: string,
): { authServerUrl: string; realm: string } | null {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.search || url.hash) return null;

  const match = url.pathname.match(/^(.*)\/realms\/([^/]+)\/?$/);
  if (!match) return null;
  // If the realm is incorrectly encoded (e.g., "%E0%A4%A"), decodeURIComponent throws,
  // so return null instead to let the caller handle fail-closed semantics.
  let realm: string;
  try {
    realm = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!realm) return null;

  // match[1] is the path prefix before /realms ("" | "/auth" etc). Standard deployments have no prefix.
  return { authServerUrl: `${url.origin}${match[1]}`, realm };
}

/**
 * Resolves OIDC configuration based on the current mode.
 *
 * - In mock/demo mode (`realBuilder=false`) or explicit dev bypass, OIDC is not required ("disabled").
 * - In real integration, if issuer/clientId is missing or issuer format is invalid, fail-closed ("error").
 */
export function resolveOidcConfig(input: {
  realBuilder: boolean;
  devBypass: boolean;
  issuer?: string;
  clientId?: string;
}): OidcConfigResult {
  if (!input.realBuilder || input.devBypass) return { status: "disabled" };

  const issuer = input.issuer?.trim();
  const clientId = input.clientId?.trim();
  if (!issuer) return { status: "error", reason: i18n.t("config.oidc.issuerMissing") };
  if (!clientId) {
    return { status: "error", reason: i18n.t("config.oidc.clientIdMissing") };
  }

  const parsed = parseOidcIssuer(issuer);
  if (!parsed) {
    return { status: "error", reason: i18n.t("config.oidc.issuerInvalid", { issuer }) };
  }

  return {
    status: "ok",
    config: {
      issuer,
      authServerUrl: parsed.authServerUrl,
      realm: parsed.realm,
      clientId,
    },
  };
}

/** Resolves OIDC configuration from the current runtime environment variables. */
export function getOidcConfig(): OidcConfigResult {
  return resolveOidcConfig({
    // Same logic as builderApi.isRealBuilderEnabled(), but read directly here to avoid circular imports.
    realBuilder: runtimeOr("useRealBuilder", import.meta.env.VITE_USE_REAL_BUILDER) === "true",
    devBypass: isDevAuthBypassEnabled(),
    issuer: runtimeOr("oidcIssuer", import.meta.env.VITE_OIDC_ISSUER),
    clientId: runtimeOr("oidcClientId", import.meta.env.VITE_OIDC_CLIENT_ID),
  });
}

/** Whether the OIDC login flow should be actually enabled in this environment. */
export function isOidcEnabled(): boolean {
  return getOidcConfig().status === "ok";
}
