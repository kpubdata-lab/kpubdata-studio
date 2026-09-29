/**
 * Suggested Action executor (#256).
 *
 * All functions here are called from `useAssistantSession` only when "user has already clicked approve button".
 * This file itself does not judge approval — calling the function is proof of approval.
 *
 * Build execution/Publish/Credential change/SQL auto-execution/overwrite existing BuildSpec are not
 * implemented in this file at all — actions not on allowlist have no executable function.
 */
import { loadBuildSpec, saveBuildSpec } from "@/features/build-spec/specStore";
import { saveDraft } from "@/features/build-spec/draftStorage";
import { validateSpec } from "@/features/validation/api";
import { hasSecretPlaceholder, isSecretKey, redactSecrets } from "@/features/assistant/scrub";
import { i18n } from "@/shared/i18n";

/** This file's text strings appear in all `assistant.actions.*` messages below (#350). */
const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(`assistant.actions.${key}`, params ?? {});
import { jsonValueHasRedactedSecret } from "@/features/add-data/paramsRedaction";
import { buildFormValuesSchema } from "@/shared/lib/schemas";
import type { BuildSpec, JsonValue } from "@/shared/lib/types";
import type { AssistantAction, BuildSpecPatchOp } from "./schema";
import { queueAssistantReportNote } from "./reportInbox";
import type { AssistantContext } from "./types";

/**
 * Allow only paths that PATCH_BUILDSPEC can touch.
 *
 * Intentionally excluded datasetId/provider/dataset (source identity) and export format —
 * prevent AI from silently swapping data sources (#256 review §10: preserve the principle
 * "Source/Export/Quality/Metadata unchanged by AI don't disappear" as patch allowlist scope too).
 */
const ALLOWED_PATCH_PATH = /^\/(title|description|metadata\/[^/]+|sources\/\d+\/(alias|params\/[^/]+)|exports\/\d+\/options\/[^/]+)$/;

/** Extract `{key}` segment from `/sources/{index}/params/{key}` path; other paths are not targets. */
const SOURCE_PARAM_PATCH_PATH = /^\/sources\/\d+\/params\/([^/]+)$/;

export type BuildSpecPatchPreview =
  | { ok: true; before: BuildSpec; after: BuildSpec }
  | { ok: false; reason: string };

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Determine if `/sources/{index}/params/{key}` patch touches credential fields (#277 review).
 *
 * Other actions like ADD_REPORT_BLOCK/OPEN_* don't create patches, so this check doesn't apply.
 * Don't create new secret detection rules here — reuse `isSecretKey` from existing scrub (#206, #226)
 * for evidence/outbound messages — maintaining a single definition "ends with serviceKey/apiKey/token/secret".
 */
function isCredentialPatchPath(path: string): boolean {
  const match = SOURCE_PARAM_PATCH_PATH.exec(path);
  if (!match) return false;
  return isSecretKey(unescapePointerSegment(match[1]));
}

/** Minimal JSON Patch (add/replace/remove) application. Path pre-validated against allowlist only. */
function applyPointerOp(target: Record<string, unknown>, op: BuildSpecPatchOp): void {
  const segments = op.path.split("/").slice(1).map(unescapePointerSegment);
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i]];
    if (typeof next !== "object" || next === null) {
      throw new Error(t("missingParent", { path: op.path }));
    }
    cursor = next as Record<string, unknown>;
  }
  const lastKey = segments[segments.length - 1];
  if (op.op === "remove") {
    delete cursor[lastKey];
    return;
  }
  cursor[lastKey] = op.value as JsonValue;
}

/**
 * Convert PATCH_BUILDSPEC action to diff preview. Does not save.
 *
 * @param action - PATCH_BUILDSPEC action awaiting approval.
 * @returns Failure reason if original spec not found or disallowed path exists; otherwise before/after.
 */
export function previewBuildSpecPatch(
  action: Extract<AssistantAction, { type: "PATCH_BUILDSPEC" }>,
): BuildSpecPatchPreview {
  const before = loadBuildSpec(action.runId);
  if (!before) {
    return {
      ok: false,
      reason: t("specNotFound", { runId: action.runId }),
    };
  }

  // By local storage policy, secret values in saved spec already erased with redaction marker; fail-closed.
  // If patch applied with marker remaining, validate step submits literal placeholder to Builder (S07 review §1).
  // Credential re-entry is Provider settings screen's responsibility.
  if (jsonValueHasRedactedSecret(before)) {
    return {
      ok: false,
      reason: t("secretsRedacted"),
    };
  }

  const invalidPath = action.patch.find((op) => !ALLOWED_PATCH_PATH.test(op.path));
  if (invalidPath) {
    return {
      ok: false,
      reason: t("pathNotAllowed", { path: invalidPath.path }),
    };
  }

  // Credential params blocked deterministically here even if allowlist passed (#277 review) —
  // not "write in prompt don't touch", but gated at Studio before save/validate.
  const credentialPath = action.patch.find((op) => isCredentialPatchPath(op.path));
  if (credentialPath) {
    return {
      ok: false,
      reason: t("credentialPath", { path: credentialPath.path }),
    };
  }

  try {
    const clone = structuredClone(before) as unknown as Record<string, unknown>;
    for (const op of action.patch) applyPointerOp(clone, op);
    if (jsonValueHasRedactedSecret(clone)) {
      return {
        ok: false,
        reason: t("redactionMarker"),
      };
    }
    return { ok: true, before, after: clone as unknown as BuildSpec };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : t("patchFailed") };
  }
}

/**
 * Save user-approved BuildSpec patch and re-run Builder `/validate` (#256 review §10).
 *
 * @param runId - Target run for patch.
 * @param after - Applied spec created by `previewBuildSpecPatch`.
 * @returns Save and validate result.
 */
export async function applyBuildSpecPatch(
  runId: string,
  after: BuildSpec,
  validate: typeof validateSpec = validateSpec,
): Promise<{ valid: boolean; errors: string[] }> {
  // `[REDACTED]` (specStore/savedSpecs) · `__KPD_*_REDACTED__` (draft) · `__SCRUBBED_*` all blocked —
  // if any marker remains during validate, literal placeholder goes to Builder.
  if (jsonValueHasRedactedSecret(after)) {
    return { valid: false, errors: [t("unresolvedPlaceholder")] };
  }
  const result = await validate(after);
  if (result.valid) saveBuildSpec(runId, after);
  return result;
}

function assertSafeGeneratedValue(value: unknown): void {
  if (hasSecretPlaceholder(value)) {
    throw new Error(t("unresolvedPlaceholder"));
  }
}

function assertSafeSourceParams(value: string): void {
  assertSafeGeneratedValue(value);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (JSON.stringify(redactSecrets(parsed)) !== JSON.stringify(parsed)) {
      throw new Error(t("paramsCredential"));
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(t("paramsNotObject"), {
        cause: error,
      });
    }
    throw error;
  }
}

/** CREATE_BUILD_DRAFT provides actual values for New Build Wizard initial slots (missing fields get defaults). */
export function draftValuesFromAction(
  action: Extract<AssistantAction, { type: "CREATE_BUILD_DRAFT" }>,
): ReturnType<typeof buildFormValuesSchema.parse> {
  assertSafeGeneratedValue(action.values);
  assertSafeSourceParams(action.values.sourceParams ?? "{}");
  return buildFormValuesSchema.parse({
    datasetId: action.values.datasetId,
    title: action.values.title,
    description: action.values.description,
    provider: action.values.provider,
    sourceDataset: action.values.sourceDataset,
    sourceParams: action.values.sourceParams ?? "{}",
    outputPath: action.values.outputPath ?? `artifacts/builds/${action.values.datasetId}`,
    exportFormats: action.values.exportFormats ?? ["jsonl"],
  });
}

/** Write values to New Build Wizard's single initial slot. Overwrites existing unsaved draft if present (warn on approve screen). */
export function applyCreateBuildDraft(action: Extract<AssistantAction, { type: "CREATE_BUILD_DRAFT" }>): void {
  saveDraft(draftValuesFromAction(action));
}

/** Queue ADD_REPORT_BLOCK approve result to Reports entry point (#258; full edit feature not included). */
export function applyAddReportBlock(
  action: Extract<AssistantAction, { type: "ADD_REPORT_BLOCK" }>,
  context: AssistantContext,
): void {
  assertSafeGeneratedValue({ note: action.note, reason: action.reason });
  queueAssistantReportNote({
    note: action.note,
    reason: action.reason,
    context: { datasetId: context.datasetId, runId: context.runId, stage: context.stage },
    savedAt: new Date().toISOString(),
  });
}

/** Calculate destination path for pure navigation action (actual navigation is caller's via react-router). */
export function actionHref(action: AssistantAction): string | null {
  switch (action.type) {
    case "OPEN_PROVIDER":
      return "/connections";
    case "OPEN_BUILD":
      return `/refresh-jobs/${encodeURIComponent(action.runId)}`;
    case "OPEN_QUALITY": {
      const params = new URLSearchParams();
      params.set("dataset", action.datasetId);
      if (action.runId) params.set("run", action.runId);
      if (action.source) params.set("source", action.source);
      if (action.stage) params.set("stage", action.stage);
      return `/quality?${params.toString()}`;
    }
    case "PATCH_BUILDSPEC":
    case "CREATE_BUILD_DRAFT":
    case "ADD_REPORT_BLOCK":
      return null;
  }
}

/** Show user a summary of the action. */
export function describeAction(action: AssistantAction): string {
  switch (action.type) {
    case "OPEN_PROVIDER":
      return t("describe.openProvider", { provider: action.provider });
    case "OPEN_BUILD":
      return t("describe.openBuild", { runId: action.runId });
    case "OPEN_QUALITY":
      return t("describe.openQuality", { datasetId: action.datasetId });
    case "PATCH_BUILDSPEC":
      return t("describe.patchSpec", { runId: action.runId, count: action.patch.length });
    case "CREATE_BUILD_DRAFT":
      return t("describe.createDraft", { title: action.values.title });
    case "ADD_REPORT_BLOCK":
      return t("describe.addReportBlock");
  }
}
