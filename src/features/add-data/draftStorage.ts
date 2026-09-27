/**
 * Add Data Workbench draft local auto-save (#250).
 *
 * Reuses save/restore logic from `features/build-spec/draftStorage.ts` as-is,
 * binding only separate key that does not overlap New Build Wizard (no duplicate
 * implementation).
 *
 * URL source endpoint and public_api source sourceParams can contain secrets
 * (#283 review response, Epic #246, follow-up review §1), so we sanitize
 * before saving to localStorage to prevent plaintext storage. Even if draft's
 * sourceKind is not currently "url"/"public_api", the fields `draft.url.endpoint`
 * and `draft.publicApi.sourceParams` may remain (previous values not cleared on
 * source switch), so always sanitize if values exist.
 *
 * Uses `sanitizeUrlEndpointForStorage` instead of `redactUrlEndpoint` (display)
 * — malformed values that `new URL()` cannot parse (query param boundaries
 * unknown) or values containing userinfo credentials can only return original or
 * partial redaction via display function; storage path is fail-closed (empty
 * value) separately (#283 follow-up review §2, §4).
 *
 * When `buildSpecFromDraft` detects sanitized endpoint/sourceParams, it
 * fail-closes and requires re-entry — does not restore/submit placeholder as
 * real value.
 */
import { clearDraft, hasDraft, loadDraft, saveDraft } from "@/features/build-spec/draftStorage";
import { ownedStorageKey } from "@/features/auth/storageOwner";
import { sanitizeUrlEndpointForStorage } from "@/features/add-data/urlRedaction";
import { redactSourceParamsObject, redactSourceParamsText } from "@/features/add-data/paramsRedaction";
import type { AddDataDraft } from "@/features/add-data/model";

// Namespace by owner key at call time (#293) — must reflect login state when
// save/restore functions are called, not at module load time.
const ADD_DATA_DRAFT_KEY = () => ownedStorageKey("kpubdata-studio:add-data-draft");

export function saveAddDataDraft(draft: AddDataDraft): void {
  const canonicalBase = draft.canonicalBase
    ? {
        ...draft.canonicalBase,
        sources: draft.canonicalBase.sources.map((source) => {
          if ((source.kind ?? "public_api") === "url" && source.endpoint) {
            return { ...source, endpoint: sanitizeUrlEndpointForStorage(source.endpoint) };
          }
          return { ...source, params: redactSourceParamsObject(source.params ?? {}).params };
        }),
      }
    : undefined;
  const safeDraft: AddDataDraft = {
    ...draft,
    canonicalBase,
    url: draft.url.endpoint
      ? { ...draft.url, endpoint: sanitizeUrlEndpointForStorage(draft.url.endpoint) }
      : draft.url,
    publicApi: draft.publicApi.sourceParams
      ? { ...draft.publicApi, sourceParams: redactSourceParamsText(draft.publicApi.sourceParams).text }
      : draft.publicApi,
  };
  saveDraft(safeDraft, ADD_DATA_DRAFT_KEY());
}

export function loadAddDataDraft(): AddDataDraft | null {
  // Draft shape can evolve freely (early versions) so we check version envelope only,
  // not zod schema — corrupted or significantly different shape is already cleaned to
  // null by loadDraft.
  return loadDraft<AddDataDraft>(undefined, ADD_DATA_DRAFT_KEY());
}

export function clearAddDataDraft(): void {
  clearDraft(ADD_DATA_DRAFT_KEY());
}

export function hasAddDataDraft(): boolean {
  return hasDraft(ADD_DATA_DRAFT_KEY());
}
