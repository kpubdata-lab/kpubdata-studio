/**
 * After selecting Public API Dataset, verify credential prerequisite before
 * Preview (#S-add-data). Guide in Configure step to avoid later Preview failure
 * with credential error.
 *
 * Block conditions (blocks only when both are true):
 *   1. Selected Dataset/Provider requires credential (CatalogDataset.requires_service_key
 *      — Builder already computes this combining provider auth requirement and
 *      dataset's service_key_param existence).
 *   2. Confirmed as unconfigured via effective `configured` from GET /providers
 *      summary (user credential > server default > none, ADR 0012).
 *
 * Does not block if `providerConfigured` is still loading (null) or provider
 * entry itself missing (query failure etc.) — per principle (requirement §3) that
 * Studio does not infer credential existence, blocking only when "definitely
 * unconfigured" is confirmed.
 */
import { i18n } from "@/shared/i18n";
import type { CatalogDataset } from "@/shared/lib/builderApi";

export interface CredentialPrerequisite {
  /** True if API connection is required before proceeding with this Dataset. */
  blocked: boolean;
}

export function checkCredentialPrerequisite(
  dataset: CatalogDataset | undefined,
  providerConfigured: Record<string, boolean> | null,
  provider: string,
): CredentialPrerequisite {
  if (!dataset?.requires_service_key) return { blocked: false };
  if (!providerConfigured || !(provider in providerConfigured)) return { blocked: false };
  return { blocked: providerConfigured[provider] === false };
}

export interface CredentialPrerequisiteMessage {
  title: string;
  body: string;
  cta: string;
}

/**
 * Resolve credential-unconfigured guidance message **at call time**.
 *
 * Previously a module-level constant, but then the message text becomes fixed
 * at import time — changing language keeps only this card in old language (#350).
 * As a function, current language is reflected on each render.
 */
export function credentialPrerequisiteMessage(): CredentialPrerequisiteMessage {
  return {
    title: i18n.t("addData.credential.title"),
    body: i18n.t("addData.credential.body"),
    cta: i18n.t("addData.credential.cta"),
  };
}

/**
 * The guidance as one line, for places that show a single error string (#620, #621).
 *
 * Every newline in the body becomes a space — not only the first — so a translation
 * that gains another line still renders as one line.
 */
export function credentialPrerequisiteNotice(message: CredentialPrerequisiteMessage): string {
  return `${message.title} — ${flattenNotice(message.body)}`;
}

/** Replace every newline with a space. */
export function flattenNotice(body: string): string {
  return body.replace(/\n/g, " ");
}
