/**
 * New Build wizard form ↔ BuildSpec assembly logic (#379 separated from NewBuildPage).
 *
 * Keeping rendering separate from assembly lets us verify "what becomes spec" without
 * reading JSX. When step order changes, assembly rules stay in one place.
 */
import type { MissingProviderKeys } from "@/shared/lib/missingProviderKey";
import { parseSourceParams } from "@/features/build-spec/paramsInput";
import {
  jsonValueHasRedactedSecret,
  redactSourceParamsText,
  sourceParamsHasRedactedSecret,
} from "@/features/add-data/paramsRedaction";
import { i18n } from "@/shared/i18n";
import type { CatalogDataset, CatalogProvider } from "@/shared/lib/builderApi";
import { buildSpecSchema } from "@/shared/lib/schemas";
import type { BuildSpec, ExportTarget, JsonValue, SourceRef } from "@/shared/lib/types";
import type { StepItem } from "@/shared/ui";

export interface BuildFormValues {
  datasetId: string;
  title: string;
  description: string;
  provider: string;
  sourceDataset: string;
  sourceParams: string;
  outputPath: string;
  exportFormats: string[];
}

export const initialValues: BuildFormValues = {
  datasetId: "",
  title: "",
  description: "",
  provider: "",
  sourceDataset: "",
  sourceParams: "{}",
  outputPath: "artifacts/builds/example",
  exportFormats: ["jsonl"],
};


export function buildSteps(t: (k: string) => string): StepItem[] {
  return [
    { id: "identity", label: t("newBuild.steps.identity") },
    { id: "source", label: t("newBuild.steps.source") },
    { id: "params", label: t("newBuild.steps.params") },
    { id: "preview", label: t("newBuild.steps.preview") },
    { id: "output", label: t("newBuild.steps.output") },
    { id: "review", label: t("newBuild.steps.review") },
  ];
}

// Form fields to validate before advancing in each step. Preview/Review steps have no input fields.
export const STEP_FIELDS: Array<Array<keyof BuildFormValues>> = [
  ["datasetId", "title", "description"],
  ["provider", "sourceDataset"],
  ["sourceParams"],
  [],
  ["exportFormats", "outputPath"],
  [],
];

/**
 * Why the wizard cannot edit this spec, or `null` when it can (#496).
 *
 * The form only expresses a `kind="public_api"` first source (provider/dataset/params).
 * A spec whose first source is a file or URL source (Add Data Workbench, #250) would be
 * rewritten into a public API source the moment the form rebuilt it, so the wizard
 * refuses to open it instead of silently changing it.
 *
 * @param spec - Spec about to be opened in the wizard.
 * @returns Localized reason, or `null` if the wizard can edit it.
 */
export function editBlockReason(spec: BuildSpec): string | null {
  const kind = spec.sources[0]?.kind ?? "public_api";
  if (kind === "public_api") return null;
  return i18n.t("newBuild.errors.unsupportedSourceKind", { kind });
}

/**
 * Build a BuildSpec candidate from form inputs and validate with zod.
 *
 * The form handles only one source and outputPath, but the spec being edited may carry
 * much more: extra sources, the first source's `kind`/`alias`/`schema`, export options
 * other than `outputPath`, metadata keys and top-level `extra`. When `base` is provided,
 * every field the form does not edit comes from `base` unchanged and only the form's own
 * fields are written over it, so an edit round-trip loses nothing (#120, #496).
 *
 * @param values - Current form input values.
 * @param base - Base spec being edited (omitted for new builds).
 * @returns Validated spec or localized error message.
 */
export function toBuildSpec(
  values: BuildFormValues,
  base?: BuildSpec | null,
): { spec?: BuildSpec; error?: string } {
  // Fail-closed: never rebuild a first source the form cannot express (#496). The page
  // already blocks entry; this keeps every other caller honest too.
  const blocked = base ? editBlockReason(base) : null;
  if (blocked) {
    return { error: blocked };
  }

  // If loading saved draft/spec with sourceParams, secret values are already redacted markers.
  // Fail-closed: don't submit redaction markers as real parameters to Builder (S07, Add Data
  // Workbench's `buildSpecFromDraft` uses the same policy). User must re-enter values.
  // `[REDACTED]` (specStore/savedSpecs) · `__KPD_*_REDACTED__` (draft) · `__SCRUBBED_*` all covered.
  if (sourceParamsHasRedactedSecret(values.sourceParams)) {
    return { error: i18n.t("newBuild.errors.draftSecretRemoved") };
  }

  const parsedParams = parseSourceParams(values.sourceParams);
  if (parsedParams.error) {
    return { error: parsedParams.error };
  }

  // Spreading base first keeps both its unedited keys (kind/alias/schema/...) and their
  // order; the form's own keys then overwrite in place.
  const firstSource: SourceRef = {
    ...base?.sources[0],
    provider: values.provider,
    dataset: values.sourceDataset,
    params: parsedParams.data ?? {},
  };

  // The form has one outputPath field, loaded from `metadata.outputPath`. A huggingface
  // export may carry its own `options.outputPath`; it only follows the form when the user
  // actually changed the field (or the export had none), so an untouched save keeps it.
  const baseOutputPath = typeof base?.metadata.outputPath === "string" ? base.metadata.outputPath : "";
  const outputPathEdited = !base || values.outputPath !== baseOutputPath;

  const exports: ExportTarget[] = values.exportFormats.map((format) => {
    const baseOptions = base?.exports.find((target) => target.format === format)?.options;
    const keepBaseOutputPath = !outputPathEdited && baseOptions?.outputPath !== undefined;
    const options = format === "huggingface" && !keepBaseOutputPath
      ? { ...baseOptions, outputPath: values.outputPath }
      : baseOptions;
    // Omit the key rather than writing `options: undefined`, so a round-trip serializes
    // to the same JSON as the original.
    return options === undefined ? { format } : { format, options };
  });

  // Keep form-unhandled metadata keys; overwrite outputPath only. A spec that never had an
  // outputPath, and still has none in the form, does not gain an empty one.
  const metadata: Record<string, JsonValue> = { ...base?.metadata };
  if (values.outputPath !== "" || !base || "outputPath" in base.metadata) {
    metadata.outputPath = values.outputPath;
  }

  const candidate: BuildSpec = {
    datasetId: values.datasetId,
    title: values.title,
    description: values.description,
    sources: [
      firstSource,
      // Form does not edit sources[1+]; preserve as-is from base.
      ...(base?.sources.slice(1) ?? []),
    ],
    exports,
    metadata,
    // Top-level canonical fields Studio does not edit (publish/splits/pii/...) (#250).
    ...(base?.extra !== undefined ? { extra: base.extra } : {}),
  };

  // Form-unhandled areas (base.sources[1+], original metadata) may still have redaction markers.
  // Fail-closed here: sourceParams[0] check alone misses this path.
  if (jsonValueHasRedactedSecret(candidate)) {
    return { error: i18n.t("newBuild.errors.specSecretRemoved") };
  }

  const result = buildSpecSchema.safeParse(candidate);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? i18n.t("newBuild.errors.specInvalid") };
  }
  return { spec: result.data };
}

/**
 * Transform BuildSpec to BuildFormValues.
 *
 * @param spec - BuildSpec object.
 * @returns BuildFormValues.
 */
export function toFormValues(spec: BuildSpec): BuildFormValues {
  const firstSource = spec.sources[0] ?? { provider: "", dataset: "", params: {} };
  return {
    datasetId: spec.datasetId,
    title: spec.title,
    description: spec.description,
    // New Build Wizard edits only kind="public_api" sources (file/url are #250 Add Data
    // Workbench exclusive). If base has missing provider/dataset, substitute empty strings.
    provider: firstSource.provider ?? "",
    sourceDataset: firstSource.dataset ?? "",
    sourceParams: Object.keys(firstSource.params).length > 0
      ? JSON.stringify(firstSource.params, null, 2)
      : "{}",
    exportFormats: spec.exports.map((e) => e.format),
    outputPath: typeof spec.metadata.outputPath === "string" ? spec.metadata.outputPath : "",
  };
}

/**
 * localStorage draft storage boundary policy (S07): redact credential-like values in sourceParams JSON
 * so they don't persist as plaintext. Apply the same function at save time (saveCurrentDraft) and
 * restore time (restoreDraft read-time rewrite) to maintain this invariant. Reuses the same
 * `paramsRedaction` helper and sentinel as Add Data draft (`saveAddDataDraft`).
 */
export function redactDraftForStorage(values: BuildFormValues): BuildFormValues {
  return { ...values, sourceParams: redactSourceParamsText(values.sourceParams).text };
}

export interface PreviewState {
  status: "idle" | "loading" | "loaded" | "error";
  rows: Record<string, unknown>[];
  schema: Record<string, string>;
  warnings: string[];
  error?: string;
  /** The preview was refused for want of these providers' keys (#787). */
  missingKeys?: MissingProviderKeys;
}

export interface ValidationState {
  status: "idle" | "validating" | "validated";
  isValid: boolean;
  errors: string[];
}

export type CatalogState =
  | { readonly status: "loading"; readonly providers: readonly CatalogProvider[]; readonly error?: undefined }
  | { readonly status: "loaded"; readonly providers: readonly CatalogProvider[]; readonly error?: undefined }
  | { readonly status: "error"; readonly providers: readonly CatalogProvider[]; readonly error: string };

export function catalogProvider(providers: readonly CatalogProvider[], provider: string): CatalogProvider | undefined {
  return providers.find((entry) => entry.name === provider);
}

export function catalogDataset(
  providers: readonly CatalogProvider[],
  provider: string,
  dataset: string,
): CatalogDataset | undefined {
  return catalogProvider(providers, provider)?.datasets.find((entry) => entry.name === dataset);
}

