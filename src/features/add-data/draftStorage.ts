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
 *
 * A restored value is checked against `addDataDraftSchema` (#605): a matching envelope
 * version alone let a value of the wrong shape reach the form, which crashed while
 * rendering and stayed stored, so every visit offered it again.
 */
import { z } from "zod";
import { clearDraft, hasDraft, loadDraft, saveDraft } from "@/features/build-spec/draftStorage";
import { ownedStorageKey } from "@/features/auth/storageOwner";
import { sanitizeUrlEndpointForStorage } from "@/features/add-data/urlRedaction";
import { redactSourceParamsObject, redactSourceParamsText } from "@/features/add-data/paramsRedaction";
import { redactSpecExtra } from "@/features/build-spec/specStore";
import { jsonRecordSchema, sourceFormatSchema, sourceKindSchema } from "@/shared/lib/schemas";
import type { AddDataDraft } from "@/features/add-data/model";

// Namespace by owner key at call time (#293) — must reflect login state when save/restore functions are called,
// not at module load time.
const ADD_DATA_DRAFT_KEY = () => ownedStorageKey("kpubdata-studio:add-data-draft");

/**
 * The canonical spec a draft keeps (`canonicalBase`), checked for the parts the draft model
 * reads. Not `buildSpecSchema`: storage redacts it (a malformed URL endpoint becomes ""),
 * and the model reports what must be typed again — the stored spec need not be submittable.
 * Unmodelled fields pass through, as in the YAML editor.
 */
const canonicalBaseSchema = z.looseObject({
  datasetId: z.string(),
  title: z.string(),
  description: z.string(),
  sources: z.array(
    z.looseObject({
      kind: sourceKindSchema.optional(),
      provider: z.string().optional(),
      dataset: z.string().optional(),
      uploadId: z.string().optional(),
      endpoint: z.string().optional(),
      format: sourceFormatSchema.optional(),
      params: jsonRecordSchema,
    }),
  ),
  exports: z.array(z.looseObject({ format: z.string(), options: jsonRecordSchema.optional() })),
  metadata: jsonRecordSchema,
  extra: jsonRecordSchema.optional(),
});

/**
 * Every field of `AddDataDraft`, with its type (#605). Drafts written before the spec was
 * kept (#283, `canonicalBase`) have no `canonicalBase` and restore as they are — the one
 * earlier shape this flow wrote. Anything else that does not match is not guessed at:
 * `loadDraft` removes it and the page says the draft could not be opened.
 */
export const addDataDraftSchema = z.object({
  canonicalBase: canonicalBaseSchema.optional(),
  sourceKind: sourceKindSchema.nullable(),
  publicApi: z.object({ provider: z.string(), dataset: z.string(), sourceParams: z.string() }),
  file: z.object({
    uploadId: z.string().nullable(),
    format: sourceFormatSchema.nullable(),
    encoding: z.string(),
    filename: z.string().nullable(),
    sizeBytes: z.number().nullable(),
  }),
  url: z.object({ endpoint: z.string(), format: z.enum(["csv", "json", "jsonl"]).nullable() }),
  datasetId: z.string(),
  title: z.string(),
  description: z.string(),
  datasetIdTouched: z.boolean(),
  titleTouched: z.boolean(),
  descriptionTouched: z.boolean(),
  exportFormats: z.array(z.string()),
  outputPath: z.string(),
  previewLimit: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  previewSampleMode: z.enum(["first", "random"]),
  previewColumns: z.enum(["key", "all"]),
});

/** `addDataDraftSchema` as `loadDraft`'s validator, typed as the draft the form uses. */
const addDataDraftValidator = {
  safeParse: (value: unknown): { success: true; data: AddDataDraft } | { success: false } => {
    const result = addDataDraftSchema.safeParse(value);
    // The loose spec schema widens unmodelled fields to `unknown`; they are carried through unchanged.
    return result.success ? { success: true, data: result.data as AddDataDraft } : { success: false };
  },
};

export function saveAddDataDraft(draft: AddDataDraft): void {
  const canonicalBase = draft.canonicalBase
    ? {
        ...draft.canonicalBase,
        sources: draft.canonicalBase.sources.map((rawSource) => {
          // Source keys Studio does not model are kept in `extra` (#601) and may hold
          // credentials (e.g. `auth.serviceKey`), so they get the same redaction as params.
          // A restored sentinel then fails closed in buildSpecFromDraft.
          const source = rawSource.extra
            ? { ...rawSource, extra: redactSourceParamsObject(rawSource.extra).params }
            : rawSource;
          if ((source.kind ?? "public_api") === "url" && source.endpoint) {
            return { ...source, endpoint: sanitizeUrlEndpointForStorage(source.endpoint) };
          }
          return { ...source, params: redactSourceParamsObject(source.params ?? {}).params };
        }),
        // Spec keys Studio does not model may hold credentials too (#616): redacted by the
        // run spec store's rule, and a restored `[REDACTED]` fails closed in buildSpecFromDraft.
        ...(draft.canonicalBase.extra ? { extra: redactSpecExtra(draft.canonicalBase.extra) } : {}),
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
  // A value of another shape is removed and null returned, like one that is not JSON (#605).
  return loadDraft<AddDataDraft>(addDataDraftValidator, ADD_DATA_DRAFT_KEY());
}

export function clearAddDataDraft(): void {
  clearDraft(ADD_DATA_DRAFT_KEY());
}

export function hasAddDataDraft(): boolean {
  return hasDraft(ADD_DATA_DRAFT_KEY());
}
