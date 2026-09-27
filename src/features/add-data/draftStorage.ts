/**
 * Add Data Workbench draft local auto-draft (#250).
 *
 * Reuses save/restore logic from features/build-spec/draftStorage.ts as-is,
 * binding only separate key that doesn't overlap with New Build Wizard (no duplicate implementation).
 *
 * URL source endpoint and public_api source sourceParams may contain secrets (#283 review response, Epic #246, follow-up §1),
 * so sanitize before storing in localStorage to prevent plaintext leakage. Even if draft.sourceKind is not currently "url"/"public_api",
 * draft.url.endpoint/draft.publicApi.sourceParams fields may still exist (previous values not cleared on source switch),
 * so always sanitize if values present.
 *
 * Use sanitizeUrlEndpointForStorage instead of redactUrlEndpoint (display-only) — malformed values (query param boundary unknown)
 * or userinfo credential values that new URL() can't parse can only be partially redacted by display function, so storage path
 * is separately fail-closed (empty value) (#283 follow-up §2, §4).
 *
 * buildSpecFromDraft detects sanitized endpoint/sourceParams and requires re-entry fail-closed — doesn't restore/submit placeholder as real value.
 */
import { clearDraft, hasDraft, loadDraft, saveDraft } from "@/features/build-spec/draftStorage";
import { ownedStorageKey } from "@/features/auth/storageOwner";
import { sanitizeUrlEndpointForStorage } from "@/features/add-data/urlRedaction";
import { redactSourceParamsObject, redactSourceParamsText } from "@/features/add-data/paramsRedaction";
import type { AddDataDraft } from "@/features/add-data/model";

// Namespace by owner key at call time (#293) — must reflect login state when save/restore functions are called,
// not at module load time.
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
   // Draft shape can evolve freely (early version) so check version envelope only without zod schema —
   // if corrupted or shape significantly differs, loadDraft already cleans it to null.
  return loadDraft<AddDataDraft>(undefined, ADD_DATA_DRAFT_KEY());
}

export function clearAddDataDraft(): void {
  clearDraft(ADD_DATA_DRAFT_KEY());
}

export function hasAddDataDraft(): boolean {
  return hasDraft(ADD_DATA_DRAFT_KEY());
}
