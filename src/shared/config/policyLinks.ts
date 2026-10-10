/**
 * Links a deployment publishes for its users (#838): the privacy policy, the terms of
 * use, and the identity provider's account page, where a user changes a password or
 * deletes the account.
 *
 * Studio does not hold these documents. The operator of a deployment is the one who
 * processes its users' personal data, so the policy and the terms are theirs, and each
 * deployment says where they are (`PRIVACY_URL`, `TERMS_URL`, `ACCOUNT_URL` in the
 * container; `VITE_*` at build time). A link that is not set is not shown.
 */
import { getOidcConfig } from "@/shared/config/env";
import { runtimeOr } from "@/shared/config/runtime";

export interface PolicyLinks {
  privacy: string | null;
  terms: string | null;
  /** The identity provider's account page. */
  account: string | null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Reads a link setting.
 *
 * Only an `https:` URL is kept, or an `http:` one on this machine (a local Keycloak).
 * The value is written into an `href`, so any other scheme gives no link — a
 * `javascript:` policy link would run on the login screen.
 */
export function resolvePolicyLink(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.href;
  return null;
}

/**
 * The account page of the identity provider Studio signs in with.
 *
 * Studio's OIDC login is Keycloak's (`keycloak-js`, kpubdata-builder ADR 0015), and a
 * Keycloak realm serves its account console at `<issuer>/account`. `ACCOUNT_URL`
 * replaces it for a deployment that serves the page elsewhere.
 */
function accountLink(): string | null {
  const configured = resolvePolicyLink(runtimeOr("accountUrl", import.meta.env.VITE_ACCOUNT_URL));
  if (configured) return configured;
  const oidc = getOidcConfig();
  if (oidc.status !== "ok") return null;
  return resolvePolicyLink(`${oidc.config.issuer.replace(/\/+$/, "")}/account`);
}

/** The links this deployment set, each null when unset or unusable. */
export function getPolicyLinks(): PolicyLinks {
  return {
    privacy: resolvePolicyLink(runtimeOr("privacyUrl", import.meta.env.VITE_PRIVACY_URL)),
    terms: resolvePolicyLink(runtimeOr("termsUrl", import.meta.env.VITE_TERMS_URL)),
    account: accountLink(),
  };
}
