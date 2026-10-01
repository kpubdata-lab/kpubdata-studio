/**
 * Add Data Workbench (#250) state model.
 *
 * Holds draft shape shared by 4 stages (Source → Configure → Preview & Validate
 * → Review & Build) and pure functions mapping that draft to submittable canonical
 * `BuildSpec`. Same role as `NewBuildPage`'s `toBuildSpec`/`toFormValues`, but Add
 * Data must handle different field sets per kind (public_api/file/url), so kept
 * separate — mapping result (`BuildSpec`) and final submission serialization
 * (`serializeSpec`/`toBuilderSpec`) reuse `features/build-spec/specMapping.ts`
 * directly (#250 amendment 1).
 */
import { parseSourceParams } from "@/features/build-spec/paramsInput";
import { identityFromUrl } from "@/features/add-data/identity";
import { endpointHasRedactedSecret, redactUrlEndpoint, urlHasUserinfo } from "@/features/add-data/urlRedaction";
import { jsonValueHasRedactedSecret, redactSourceParamsObject, sourceParamsHasRedactedSecret } from "@/features/add-data/paramsRedaction";
import { buildSpecSchema } from "@/shared/lib/schemas";
import type { BuildSpec, JsonValue, SourceFormat, SourceKind, SourceRef } from "@/shared/lib/types";
import { i18n } from "@/shared/i18n";

/** All strings in this file live under `addData.model.*` (#350). */
const t = (key: string): string => i18n.t(`addData.model.${key}`);

export interface PublicApiDraft {
  provider: string;
  dataset: string;
  /** JSON textarea source. Validated via `parseSourceParams` (reuse same logic as NewBuildPage). */
  sourceParams: string;
}

export interface FileDraft {
  /** Builder-issued upload_id after successful upload. Null before upload. */
  uploadId: string | null;
  format: SourceFormat | null;
  encoding: string;
  /** Display-only original filename (preserves Builder response original_filename as-is). */
  filename: string | null;
  sizeBytes: number | null;
}

export interface UrlDraft {
  endpoint: string;
  /** URL source format is optional (csv/json/jsonl) — omit to let Builder infer from Content-Type. */
  format: Extract<SourceFormat, "csv" | "json" | "jsonl"> | null;
}

export type PreviewSampleMode = "first" | "random";
export type PreviewLimit = 5 | 10 | 20;
export type PreviewColumnView = "key" | "all";

export interface AddDataDraft {
  /** Canonical spec read from YAML. Preserved separately from GUI projection. */
  canonicalBase?: BuildSpec;
  /** Source step has not yet been selected; null until chosen. */
  sourceKind: SourceKind | null;
  publicApi: PublicApiDraft;
  file: FileDraft;
  url: UrlDraft;
  datasetId: string;
  title: string;
  description: string;
    /**
     * Whether user directly edited this field in advanced settings (Dataset metadata)
     * (#250 amendment 2). If true, auto-gen values will no longer overwrite when
     * provider/dataset/file/endpoint changes — values from identity.ts are defaults;
     * user-chosen values always win.
     */
  datasetIdTouched: boolean;
  titleTouched: boolean;
  descriptionTouched: boolean;
  exportFormats: string[];
  outputPath: string;
  previewLimit: PreviewLimit;
  previewSampleMode: PreviewSampleMode;
  previewColumns: PreviewColumnView;
}

export const INITIAL_DRAFT: AddDataDraft = {
  canonicalBase: undefined,
  sourceKind: null,
  publicApi: { provider: "", dataset: "", sourceParams: "{}" },
  file: { uploadId: null, format: null, encoding: "utf-8", filename: null, sizeBytes: null },
  url: { endpoint: "", format: null },
  datasetId: "",
  title: "",
  description: "",
  datasetIdTouched: false,
  titleTouched: false,
  descriptionTouched: false,
  exportFormats: ["jsonl"],
  outputPath: "",
  previewLimit: 5,
  previewSampleMode: "first",
  previewColumns: "key",
};

export interface BuildSpecResult {
  spec?: BuildSpec;
  error?: string;
}

interface CandidateResult {
    /**
     * Best-effort BuildSpec from merging current GUI values + canonicalBase
     * preserved fields. May exist even with sentinel remaining (= `error` present
     * too) — YAML editor needs candidate itself to show places where sentinel
     * should be replaced with real values (#283 follow-up review §3).
     */
  candidate?: BuildSpec;
  /** Reason candidate should not be treated as submittable spec (if any). */
  error?: string;
}

/**
 * Build candidate BuildSpec from draft GUI values. Sentinel fail-closed check and
 * schema validation are done separately by caller (`buildSpecFromDraft`) — this
 * function itself calculates "what can we show on screen now", not "is it
 * submittable".
 */
function buildCandidateFromDraft(draft: AddDataDraft): CandidateResult {
  if (!draft.sourceKind) {
    return { error: t("sourceRequired") };
  }
  if (draft.exportFormats.length === 0) {
    return { error: t("exportRequired") };
  }
  if (!draft.datasetId || !draft.title || !draft.description) {
    return { error: t("metadataRequired") };
  }

  let source;
   // Only record that sentinel remains (sentinelError); build source anyway — candidate
   // must exist so YAML editor can show canonical spec with sentinel and user can
   // replace sentinel with real values.
  let sentinelError: string | undefined;
  if (draft.sourceKind === "public_api") {
    if (!draft.publicApi.provider || !draft.publicApi.dataset) {
      return { error: t("providerDatasetRequired") };
    }
     // Restored from saved draft but sourceParams secret already wiped to sentinel —
     // fail-closed — do not submit placeholder as real parameter to Builder (#283
     // follow-up review §1). User must re-enter for Preview/Build to work.
    if (sourceParamsHasRedactedSecret(draft.publicApi.sourceParams)) {
      sentinelError = t("paramsRedacted");
    }
    const parsedParams = parseSourceParams(draft.publicApi.sourceParams);
    if (parsedParams.error) return { error: parsedParams.error };
    source = {
      provider: draft.publicApi.provider,
      dataset: draft.publicApi.dataset,
      params: parsedParams.data ?? {},
    };
  } else if (draft.sourceKind === "file") {
    if (!draft.file.uploadId || !draft.file.format) {
      return { error: t("uploadRequired") };
    }
    source = {
      kind: "file" as const,
      uploadId: draft.file.uploadId,
      format: draft.file.format,
      encoding: draft.file.encoding,
      params: {},
    };
  } else {
    if (!draft.url.endpoint) {
      return { error: t("endpointRequired") };
    }
     // Restored from saved draft but endpoint secret query param already wiped to REDACTED
     // — fail-closed — do not submit placeholder as real endpoint/credential to Builder
     // (Epic #246). User must re-enter for Preview/Build to work.
    if (endpointHasRedactedSecret(draft.url.endpoint)) {
      sentinelError = t("urlRedacted");
    }
     // URL Auth (userinfo credential) not in contract (#283 follow-up review §4) —
     // silently supporting `user:pass@host` instead fail-close always.
    if (urlHasUserinfo(draft.url.endpoint)) {
      return {
        error: t("urlUserInfo"),
      };
    }
    if (!/^https:\/\//i.test(draft.url.endpoint)) {
      return { error: t("httpsOnly") };
    }
    source = {
      kind: "url" as const,
      endpoint: draft.url.endpoint,
      method: "GET" as const,
      ...(draft.url.format ? { format: draft.url.format } : {}),
      params: {},
    };
  }

  const base = draft.canonicalBase;
  const baseSource = base?.sources[0];
  const samePrimary = baseSource && (
    draft.sourceKind === (baseSource.kind ?? "public_api") &&
    (draft.sourceKind === "public_api"
      ? baseSource.provider === draft.publicApi.provider && baseSource.dataset === draft.publicApi.dataset
      : draft.sourceKind === "file"
        ? baseSource.uploadId === draft.file.uploadId
        // URL identity SSOT (hostname+path) — reuse same criteria. Query/userinfo/
        // fragment changes alone do not change source (identity.ts already treats as
        // same), so compare via identityFromUrl().datasetId instead of endpoint text
        // to preserve trailing fields like alias/schema (#283 follow-up review §5).
        : !!baseSource.endpoint &&
          identityFromUrl(baseSource.endpoint).datasetId !== "" &&
          identityFromUrl(baseSource.endpoint).datasetId === identityFromUrl(draft.url.endpoint).datasetId)
  );
  const projectedSource = source as SourceRef;
  const mergedPrimary: SourceRef = samePrimary ? { ...baseSource, ...projectedSource } : projectedSource;
  // Same format base export may exist multiple times (#283 follow-up review §7) so
  // finding first each time would let second+ occurrence overwrite first's
  // options/output_path — consume each base export by index once to preserve per-
  // occurrence settings.
  const usedBaseExportIndices = new Set<number>();
  const exports = draft.exportFormats.map((format) => {
    const preservedIndex = base?.exports.findIndex(
      (item, index) => item.format === format && !usedBaseExportIndices.has(index),
    );
    const preserved = preservedIndex !== undefined && preservedIndex >= 0 ? base?.exports[preservedIndex] : undefined;
    if (preservedIndex !== undefined && preservedIndex >= 0) usedBaseExportIndices.add(preservedIndex);
    return {
      ...(preserved ?? {}),
      format,
      options: {
        ...(preserved?.options ?? {}),
        ...(draft.outputPath ? { outputPath: draft.outputPath } : {}),
      },
    };
  });
  const metadata: Record<string, JsonValue> = {
    ...(base?.metadata ?? {}),
    ...(draft.outputPath ? { outputPath: draft.outputPath } : {}),
  };
  const candidate: BuildSpec = {
    datasetId: draft.datasetId,
    title: draft.title,
    description: draft.description,
    sources: [mergedPrimary, ...(base?.sources.slice(1) ?? [])],
    exports,
    metadata,
    ...(base?.extra ? { extra: base.extra } : {}),
  };

  return sentinelError ? { candidate, error: sentinelError } : { candidate };
}

/**
 * Build canonical BuildSpec from current draft.
 *
 * @param draft - Current Add Data draft.
 * @returns Validated spec or error message.
 */
export function buildSpecFromDraft(draft: AddDataDraft): BuildSpecResult {
  const { candidate, error: candidateError } = buildCandidateFromDraft(draft);
  if (candidateError) return { error: candidateError };
  if (!candidate) return { error: t("specBuildFailed") };

  // Check final candidate (current GUI + canonicalBase preserved + primary source
  // merge all applied) for sentinel (#283 follow-up review §2). If user re-entered
  // primary source, old canonicalBase sentinels already overwritten in merge above —
  // won't error here. But sentinels in GUI-unedited areas like sources[1+] (trailing)
  // stay fail-closed blocked.
  if (jsonValueHasRedactedSecret(candidate)) {
    return { error: t("unresolvedPlaceholder") };
  }

  const result = buildSpecSchema.safeParse(candidate);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? t("specInvalid") };
  }
  return { spec: result.data as BuildSpec };
}

/**
 * YAML editor display-only — creates canonical BuildSpec that can be shown for
 * draft now, independent of submission readiness (sentinel fail-closed, schema
 * validation) (#283 follow-up §3). Even if sentinel remains, returns candidate
 * so user doesn't lose place to replace sentinel with real value in YAML and
 * re-apply. Never used for Preview/Build submission — those always go through
 * `buildSpecFromDraft`.
 */
export function buildEditableSpecFromDraft(draft: AddDataDraft): BuildSpec | undefined {
  return buildCandidateFromDraft(draft).candidate;
}

/**
 * Reflect BuildSpec back to draft (reverse of `buildSpecFromDraft`).
 *
 * User may have pasted different source kind in YAML tab, so re-bucket draft's
 * kind-specific fields by sources[0].kind. Draft-only values like preview options
 * (previewLimit etc.) that don't exist in canonical BuildSpec stay unchanged.
 *
 * @param draft - Target draft for reflection.
 * @param spec - BuildSpec from YAML editor, etc.
 * @returns New draft with source/identity/output fields updated per spec.
 */
export function applyBuildSpecToDraft(draft: AddDataDraft, spec: BuildSpec): AddDataDraft {
  const source = spec.sources[0];
  const kind: SourceKind = source?.kind ?? "public_api";

  const next: AddDataDraft = {
    ...draft,
    sourceKind: kind,
    datasetId: spec.datasetId,
    title: spec.title,
    description: spec.description,
    canonicalBase: spec,
    // YAML/canonical BuildSpec edit counts as explicit edit (same level as advanced
    // settings) — auto-gen will not overwrite even if provider/dataset/file/URL changes
    // afterward.
    datasetIdTouched: true,
    titleTouched: true,
    descriptionTouched: true,
    exportFormats: spec.exports.map((e) => e.format),
    outputPath: typeof spec.metadata.outputPath === "string" ? spec.metadata.outputPath : draft.outputPath,
  };

  if (kind === "public_api") {
    next.publicApi = {
      provider: source?.provider ?? "",
      dataset: source?.dataset ?? "",
      sourceParams: source && Object.keys(source.params).length > 0
        ? JSON.stringify(source.params, null, 2)
        : "{}",
    };
  } else if (kind === "file") {
    next.file = {
      uploadId: source?.uploadId ?? null,
      format: source?.format ?? null,
      encoding: source?.encoding ?? "utf-8",
      filename: draft.file.filename,
      sizeBytes: draft.file.sizeBytes,
    };
  } else {
    next.url = {
      endpoint: source?.endpoint ?? "",
      format: (source?.format as UrlDraft["format"]) ?? null,
    };
  }

  return next;
}

/**
 * Build preview signature from draft + preview options.
 *
 * Different signature between Preview/Validate time and now → consider preview
 * stale, block Build (same pattern as `NewBuildPage`'s `validatedSnapshotRef`, #72).
 * Column view (key/all) and diff screen toggles just re-render received response,
 * no new Preview call needed, so excluded from signature.
 */
/**
 * Display-only — create copy of canonical BuildSpec with url source endpoint,
 * public_api source params and every source's `extra` (#601) replaced by
 * secret-redacted versions (PR #283 review
 * response, Epic #246, follow-up review §1). Used only in Review screen's "actual
 * canonical BuildSpec to be submitted" preview; actual Builder submission uses spec
 * from `buildSpecFromDraft` result directly, not via this function.
 */
export function redactBuildSpecForDisplay(spec: BuildSpec): BuildSpec {
  return {
    ...spec,
    sources: spec.sources.map((rawSource) => {
      // Unmodelled source keys (`extra`, #601) may carry credentials too.
      const source = rawSource.extra
        ? { ...rawSource, extra: redactSourceParamsObject(rawSource.extra).params }
        : rawSource;
      if (source.kind === "url" && source.endpoint) {
        return { ...source, endpoint: redactUrlEndpoint(source.endpoint).endpoint };
      }
      const { params } = redactSourceParamsObject(source.params ?? {});
      return { ...source, params };
    }),
  };
}

export function draftSignature(draft: AddDataDraft): string {
  const specResult = buildSpecFromDraft(draft);
  return JSON.stringify({
    spec: specResult.spec ?? specResult.error,
    limit: draft.previewLimit,
    sampleMode: draft.previewSampleMode,
  });
}
