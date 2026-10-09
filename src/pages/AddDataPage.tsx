/**
 * Create a table (`/add`, #250, #534) — the one table creation flow.
 *
 * Three steps: Configure (source, credentials, request parameters, application) →
 * Preview & Validate → Create (with the table's logical name from Builder's preview).
 * `/refresh-jobs/new`, the second wizard this replaced, redirects here with its query, so a
 * Workspace saved spec (`?savedSpecId=`) and an Ask KPubData draft open in this flow.
 * Editing an existing table's spec stays on `/refresh-jobs/:id/edit` (#496). Values, state,
 * limits and availability follow the Builder contract.
 *
 * Reuse:
 *  - Builder API client/Zod schema — `shared/lib/builderApi.ts`
 *  - BuildSpec mapping/serialization — `features/build-spec/specMapping.ts` (ensures
 *    submission and Review display use same `toBuilderSpec` call result, #250 amendment 1)
 *  - Draft storage — `features/build-spec/draftStorage.ts` (reused with different key)
 *  - Preview/Validate/Build execution — `features/preview/api`, `features/validation/api`,
 *    `features/runs/useBuildJob` (inherit mock/real branching and real run_id guarantee)
 *  - Quality display — `features/quality/model.ts`, `features/quality/QualityBadge`
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchCatalog, fetchProviderConfigured, uploadSourceFile } from "@/features/add-data/api";
import {
  checkCredentialPrerequisite,
  credentialPrerequisiteMessage,
  credentialPrerequisiteNotice,
} from "@/features/add-data/credentialPrerequisite";
import { ConfigureStep, type CatalogState, type UploadState } from "@/features/add-data/components/ConfigureStep";
import { PreviewValidationStep, type PreviewState } from "@/features/add-data/components/PreviewValidationStep";
import { ReviewBuildStep } from "@/features/add-data/components/ReviewBuildStep";
import {
  findExistingTables,
  sameExistingTables,
  specToBuild,
  type ExistingTableChoice,
  type ExistingTables,
} from "@/features/add-data/existingTables";
import { previewProblem } from "@/features/add-data/previewGate";
import { SourceStep } from "@/features/add-data/components/SourceStep";
import { getSavedSpec } from "@/features/workspace/savedSpecs";
import { clearAddDataDraft, hasAddDataDraft, loadAddDataDraft, saveAddDataDraft } from "@/features/add-data/draftStorage";
import { discardFormDraft, hasFormDraft, subscribeFormDraft, takeFormDraftSpec, type FormDraftResult } from "@/features/add-data/formDraft";
import { checkRequiredParams } from "@/features/add-data/requiredParams";
import { findDataset, identityFromCatalog, identityFromFilename, identityFromUrl } from "@/features/add-data/identity";
import {
  INITIAL_DRAFT,
  applyBuildSpecToDraft,
  buildEditableSpecFromDraft,
  buildSpecFromDraft,
  draftSignature,
  type AddDataDraft,
  type PreviewColumnView,
  type PreviewLimit,
  type PreviewSampleMode,
} from "@/features/add-data/model";
import { BuildSpecShapeError, YamlSyntaxError, fromYamlText, toYamlText } from "@/features/build-spec/yamlText";
import type { BuildFormValues } from "@/features/build-spec/newBuildModel";
import type { BuildSpec, SourceKind } from "@/shared/lib/types";
import { previewBuildDetailed } from "@/features/preview/api";
import { useBuildJob } from "@/features/runs/useBuildJob";
import { retryOfFor } from "@/features/runs/api";
import { BuildKeyNotice } from "@/features/provider/BuildKeyNotice";
import { missingProviderKeys } from "@/shared/lib/missingProviderKey";
import { validateSpec } from "@/features/validation/api";
import { i18n } from "@/shared/i18n";
import { Button, Card, PageHeader, Stepper } from "@/shared/ui";
import { ApiError } from "@/shared/lib/builderApi";

// Labels must follow screen language, so create at render time, not as constants.
const STEP_IDS = ["configure", "preview", "create"] as const;


/**
 * What the form can use of an Ask KPubData draft that did not become a spec: the source and
 * the table's identity, with empty parameters to type again. Every value set here counts
 * as chosen, so the catalog's identity sync does not overwrite it.
 */
function draftFromFormValues(values: BuildFormValues): AddDataDraft {
  return {
    ...INITIAL_DRAFT,
    sourceKind: "public_api",
    publicApi: { provider: values.provider, dataset: values.sourceDataset, sourceParams: "{}" },
    datasetId: values.datasetId,
    title: values.title,
    description: values.description,
    datasetIdTouched: values.datasetId !== "",
    titleTouched: values.title !== "",
    descriptionTouched: values.description !== "",
    exportFormats: values.exportFormats.length > 0 ? values.exportFormats : INITIAL_DRAFT.exportFormats,
    outputPath: values.outputPath,
  };
}

/** Builder's 409 `upload_quota_exceeded` (builder#1045): the user is at an upload limit. */
export function isUploadLimitReached(cause: unknown): boolean {
  if (!(cause instanceof ApiError) || cause.status !== 409) return false;
  const details = cause.details;
  return typeof details === "object" && details !== null && (details as { code?: unknown }).code === "upload_quota_exceeded";
}

export function AddDataPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const job = useBuildJob();

  const [draft, setDraft] = useState<AddDataDraft>(INITIAL_DRAFT);
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading", providers: [] });
  // Effective credential configuration status per provider (GET /providers summary). null =
  // still loading or query failed — credential prerequisite doesn't block anything when null
  // (§3: Studio doesn't guess credential existence).
  const [providerConfigured, setProviderConfigured] = useState<Record<string, boolean> | null>(null);
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [previewView, setPreviewView] = useState<"sample" | "diff">("sample");
  const [validation, setValidation] = useState<{ status: "idle" | "validating" | "validated"; valid: boolean; errors: string[] }>(
    { status: "idle", valid: false, errors: [] },
  );
  const [yamlEditError, setYamlEditError] = useState<string>();
  // This flow's own draft and a form-shaped one Ask KPubData left (formDraft.ts). When
  // both wait, the banner makes the person pick one and removes the other.
  const [waitingDrafts, setWaitingDrafts] = useState(() => ({ saved: hasAddDataDraft(), ask: hasFormDraft() }));
  // Why the Ask KPubData draft could not become a spec. The draft stays in storage until
  // the table is created or the person discards it (#534 review).
  const [formDraftError, setFormDraftError] = useState<string | null>(null);
  // A draft that was chosen but could not be read (not JSON, an old shape) — it was removed.
  const [corruptDraft, setCorruptDraft] = useState<"saved" | "ask" | null>(null);
  // Opening a draft over what was being typed keeps that input as this flow's saved draft (#604).
  const [inputKept, setInputKept] = useState(false);
  const [openedSavedSpecName, setOpenedSavedSpecName] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [lastPreviewSignature, setLastPreviewSignature] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingTables>({ status: "checking" });
  const [tableChoice, setTableChoice] = useState<ExistingTableChoice>("new");
  // Raised to ask again after the tables could not be read.
  const [existingAsked, setExistingAsked] = useState(0);
  // The answer changed between the review step showing it and "Create table" (#861).
  const [existingChanged, setExistingChanged] = useState(false);
  const askingAgainRef = useRef(false);

  const preselectApplied = useRef(false);
  const savedSpecApplied = useRef(false);
  // Ref storing the source identity key after last auto-sync (#250 final validation §1).
  // When source identity changes (provider+dataset/URL/file — real replacement, not
  // just detail config change), reset touched flags and force-apply new identity to
  // distinguish from detail config changes like query params/output/preview.
  const lastIdentitySourceRef = useRef<string | null>(null);
  const previewRequestIdRef = useRef(0);

  const updateDraft = useCallback((patch: Partial<AddDataDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  // Ask KPubData can approve a draft while this page is open: it saves the draft and
  // navigates to `/add`, which does not mount the page again. Offer the draft as soon as it
  // is written, and drop the offer when it is removed elsewhere (#604).
  useEffect(
    () => subscribeFormDraft(() => setWaitingDrafts((current) => ({ ...current, ask: hasFormDraft() }))),
    [],
  );

  // Source/config changed after preview → treat as stale (#250 §2, §6).
  const currentSignature = draftSignature(draft);
  const isStale = lastPreviewSignature !== null && lastPreviewSignature !== currentSignature;

  useEffect(() => {
    const controller = new AbortController();
    fetchCatalog(controller.signal)
      .then((response) => setCatalog({ status: "loaded", providers: response.providers }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setCatalog({
          status: "error",
          providers: [],
          error: cause instanceof Error ? cause.message : i18n.t("addData.errors.catalog"),
        });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchProviderConfigured(controller.signal)
      .then((configured) => {
        if (!controller.signal.aborted) setProviderConfigured(configured);
      })
      .catch(() => {
        // Query failure doesn't mean "not configured" — leaving null preserves
        // prerequisite behavior (see state declaration comment above).
      });
    return () => controller.abort();
  }, []);

  // Discover preselection (#249 — don't hard-block completion, just read query params).
  useEffect(() => {
    if (preselectApplied.current || catalog.status !== "loaded") return;
    const provider = searchParams.get("provider");
    const dataset = searchParams.get("dataset");
    if (!provider || !dataset) return;
    const knownProvider = catalog.providers.find((p) => p.name === provider);
    const found = knownProvider?.datasets.find((d) => d.name === dataset);
    preselectApplied.current = true;
    // Source and its settings share the Configure step, so there is no step to skip.
    // Coming from the Catalog means a public API whatever else is known: the kind is set
    // even when this catalogue does not list the dataset, so it is not asked for again
    // (#842). What it does not list is left for the user to pick — never guessed.
    setDraft((current) => ({
      ...current,
      sourceKind: "public_api",
      publicApi: found
        ? { ...current.publicApi, provider, dataset }
        : knownProvider
          ? { ...current.publicApi, provider, dataset: "" }
          : current.publicApi,
    }));
  }, [catalog, searchParams]);

  // Workspace "open saved spec" (#260), formerly handled by the second wizard. Applied
  // once; the saved spec itself is not changed by opening it.
  useEffect(() => {
    if (savedSpecApplied.current) return;
    savedSpecApplied.current = true;
    const savedSpecId = searchParams.get("savedSpecId");
    if (!savedSpecId) return;
    const entry = getSavedSpec(savedSpecId);
    if (!entry) return;
    applySpec(entry.spec, INITIAL_DRAFT);
    setOpenedSavedSpecName(entry.name);
    // Once per mount: savedSpecApplied guards it; applySpec only uses refs and setters.
  }, [searchParams]);

  // Public API: when provider/dataset selection changes, auto-sync dataset identity
  // (ID/title/description) from catalog dataset (#250 amendment 2). User-edited
  // fields (*Touched) in advanced settings stay during same-dataset detail changes
  // (query params etc) — but when provider/dataset itself changes (source replacement),
  // reset touched and force-apply new catalog dataset identity (#250 final validation §1).
  useEffect(() => {
    if (draft.sourceKind !== "public_api") return;
    const { provider, dataset } = draft.publicApi;
    if (!provider || !dataset) return;
    const catalogDataset = findDataset(catalog.providers, provider, dataset);
    if (!catalogDataset) return;
    const identity = identityFromCatalog(provider, catalogDataset);
    const sourceKey = `public_api:${provider}:${dataset}`;
    setDraft((current) => {
      if (current.sourceKind !== "public_api" || current.publicApi.provider !== provider || current.publicApi.dataset !== dataset) {
        return current;
      }
      const sourceChanged = lastIdentitySourceRef.current !== null && lastIdentitySourceRef.current !== sourceKey;
      lastIdentitySourceRef.current = sourceKey;
      if (sourceChanged) {
        // This effect handles only auto-generated identity (ID/title/description) and touched flags.
        // Dataset-specific request param (sourceParams) reset is handled atomically by
        // Provider/Dataset <select> onChange in same updateDraft — doing it here risks
        // StrictMode's updater double-call dropping reset results due to ref mutation inside
        // setDraft updater (#S-stale-params).
        return {
          ...current,
          datasetId: identity.datasetId,
          title: identity.title,
          description: identity.description,
          datasetIdTouched: false,
          titleTouched: false,
          descriptionTouched: false,
        };
      }
      const patch: Partial<AddDataDraft> = {};
      if (!current.datasetIdTouched && current.datasetId !== identity.datasetId) patch.datasetId = identity.datasetId;
      if (!current.titleTouched && current.title !== identity.title) patch.title = identity.title;
      if (!current.descriptionTouched && current.description !== identity.description) patch.description = identity.description;
      return Object.keys(patch).length > 0 ? { ...current, ...patch } : current;
    });
  }, [draft.sourceKind, draft.publicApi.provider, draft.publicApi.dataset, catalog.providers]);

  // URL: auto-sync dataset identity from hostname/path only (query string/credential
  // excluded by identityFromUrl). When hostname+path itself changes (endpoint replacement),
  // reset touched and force-apply new identity — if only query string changes (same endpoint
  // identity), preserve touched state to protect user-edited metadata (#250 final validation §1).
  useEffect(() => {
    if (draft.sourceKind !== "url" || !draft.url.endpoint) return;
    const identity = identityFromUrl(draft.url.endpoint);
    if (!identity.datasetId) return;
    // identity.datasetId determined only from hostname+path (query string excluded), so it's
    // safe to use as-is as key for judging "same endpoint identity".
    const sourceKey = `url:${identity.datasetId}`;
    setDraft((current) => {
      if (current.sourceKind !== "url" || current.url.endpoint !== draft.url.endpoint) return current;
      const sourceChanged = lastIdentitySourceRef.current !== null && lastIdentitySourceRef.current !== sourceKey;
      lastIdentitySourceRef.current = sourceKey;
      if (sourceChanged) {
        return {
          ...current,
          datasetId: identity.datasetId,
          title: identity.title,
          description: identity.description,
          datasetIdTouched: false,
          titleTouched: false,
          descriptionTouched: false,
        };
      }
      const patch: Partial<AddDataDraft> = {};
      if (!current.datasetIdTouched && current.datasetId !== identity.datasetId) patch.datasetId = identity.datasetId;
      if (!current.titleTouched && current.title !== identity.title) patch.title = identity.title;
      if (!current.descriptionTouched && current.description !== identity.description) patch.description = identity.description;
      return Object.keys(patch).length > 0 ? { ...current, ...patch } : current;
    });
  }, [draft.sourceKind, draft.url.endpoint]);

  // Changing source kind itself is the largest unit of "source replacement" — reset touched
  // flags and auto-generated identity fields so previous source metadata doesn't linger
  // (#250 final validation §1).
  function selectSource(kind: AddDataDraft["sourceKind"]) {
    setDraft((current) => {
      if (current.sourceKind === kind) return current;
      lastIdentitySourceRef.current = null;
      return {
        ...current,
        sourceKind: kind,
        datasetId: "",
        title: "",
        description: "",
        datasetIdTouched: false,
        titleTouched: false,
        descriptionTouched: false,
      };
    });
  }

  // Move focus to the new step's heading whenever the step changes — by Next, Back or the
  // Stepper (#669) — so a screen reader announces where the person now is instead of
  // staying on the button that was pressed. The first render keeps the browser's focus.
  const stepRegionRef = useRef<HTMLDivElement>(null);
  const focusedStepRef = useRef(step);
  useEffect(() => {
    if (focusedStepRef.current === step) return;
    focusedStepRef.current = step;
    stepRegionRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [step]);

  function goNext() {
    if (step === 0 && (!draft.sourceKind || buildSpecFromDraft(draft).error)) return;
    setStep((s) => Math.min(s + 1, STEP_IDS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  /**
   * "Connect API" CTA — reuse existing draft persistence (`saveAddDataDraft`), save draft,
   * then navigate to Provider screen. URL carries only provider id and safe return destination
   * — never includes credential/full BuildSpec (#4).
   */
  function handleConnectProvider(provider: string) {
    saveAddDataDraft(draft);
    navigate(`/connections?provider=${encodeURIComponent(provider)}&returnTo=${encodeURIComponent("/add")}`);
  }

  async function handleUploadFile(file: File) {
    if (!draft.file.format) return;
    setUpload({ status: "uploading" });
    try {
      const meta = await uploadSourceFile(file, draft.file.format);
      const identity = identityFromFilename(meta.original_filename ?? file.name);
      // Upload always means "pick (new) file" — even replacing existing file with different one
      // resets touched and applies new filename identity every time
      // (#250 final validation §1: "File replacement: reset touched then apply new filename identity").
      lastIdentitySourceRef.current = `file:${meta.original_filename ?? file.name}`;
      setDraft((current) => ({
        ...current,
        file: {
          uploadId: meta.upload_id,
          format: meta.format,
          encoding: meta.encoding,
          filename: meta.original_filename,
          sizeBytes: meta.size_bytes,
          expiresAt: meta.expires_at ?? null,
        },
        datasetId: identity.datasetId,
        title: identity.title,
        description: identity.description,
        datasetIdTouched: false,
        titleTouched: false,
        descriptionTouched: false,
      }));
      setUpload({ status: "done" });
    } catch (cause) {
      setUpload({
        status: "error",
        error: cause instanceof Error ? cause.message : i18n.t("addData.errors.upload"),
        limitReached: isUploadLimitReached(cause),
      });
    }
  }

  /**
   * Put a whole BuildSpec into the draft (YAML Apply, a saved spec, an Ask KPubData draft).
   * `base` replaces the current draft when given.
   */
  function applySpec(spec: BuildSpec, base?: AddDataDraft) {
    // Applying a spec is explicit authoring (#250 amendment 2), so applyBuildSpecToDraft sets
    // all *Touched to true — but Public API/URL identity effects only check provider/dataset/
    // endpoint changes to judge "source changed", so if we don't sync lastIdentitySourceRef
    // to the spec's source first, they'll misfire as sourceChanged and overwrite just-set explicit
    // metadata (#283 follow-up review §6). Sync ref first so effects take "same-source detail
    // change" path (respecting touched).
    const appliedSource = spec.sources[0];
    const appliedKind: SourceKind = appliedSource?.kind ?? "public_api";
    if (appliedKind === "public_api" && appliedSource?.provider && appliedSource.dataset) {
      lastIdentitySourceRef.current = `public_api:${appliedSource.provider}:${appliedSource.dataset}`;
    } else if (appliedKind === "url" && appliedSource?.endpoint) {
      const identity = identityFromUrl(appliedSource.endpoint);
      lastIdentitySourceRef.current = identity.datasetId ? `url:${identity.datasetId}` : lastIdentitySourceRef.current;
    }
    setDraft((current) => applyBuildSpecToDraft(base ?? current, spec));
  }

  function handleApplyYaml(text: string) {
    try {
      applySpec(fromYamlText(text));
      setYamlEditError(undefined);
    } catch (cause) {
      if (cause instanceof YamlSyntaxError) {
        setYamlEditError(i18n.t("addData.errors.yamlSyntax", { message: cause.message }));
      } else if (cause instanceof BuildSpecShapeError) {
        setYamlEditError(cause.message);
      } else {
        setYamlEditError(i18n.t("addData.errors.yamlApply"));
      }
    }
  }

  async function runPreviewAndValidate() {
    // Invalid/local-failure requests must also mark in-flight network requests as logically
    // stale (#283 follow-up review §4), so increment requestId before specResult check/return.
    // This ensures late-arriving previous request responses don't overwrite current error state.
    const requestId = ++previewRequestIdRef.current;
    // Which settings this attempt is of, whatever comes of it. A preview that failed is a
    // preview of these settings too: recorded only on success, the review step took a
    // failure after a change of settings for "the settings changed, run it again" — and
    // said so again however often it was run (#842).
    const signatureAtRequest = draftSignature(draft);
    const specResult = buildSpecFromDraft(draft);
    if (specResult.error || !specResult.spec) {
      setLastPreviewSignature(signatureAtRequest);
      setPreview({ status: "error", error: specResult.error ?? i18n.t("addData.errors.spec") });
      setValidation({
        status: "validated",
        valid: false,
        errors: [specResult.error ?? i18n.t("addData.errors.spec")],
      });
      return;
    }
    const spec = specResult.spec;

    // Preview usability preflight — works only when Dataset metadata provides required query
    // params. If missing, don't call Preview API, just guide user in UI
    // (doesn't replace Builder validation, just pre-guides).
    if (draft.sourceKind === "public_api") {
      const selected = findDataset(catalog.providers, draft.publicApi.provider, draft.publicApi.dataset);

      // Credential prerequisite — don't reach Preview only to fail late with credential error
      // (§3). Reuse same check as Configure step banner.
      const prerequisite = checkCredentialPrerequisite(selected, providerConfigured, draft.publicApi.provider);
      if (prerequisite.blocked) {
        const message = credentialPrerequisiteNotice(credentialPrerequisiteMessage());
        setLastPreviewSignature(signatureAtRequest);
        setPreview({ status: "error", error: message });
        setValidation({ status: "validated", valid: false, errors: [message] });
        return;
      }

      const requiredCheck = checkRequiredParams(draft.publicApi.sourceParams, selected?.request_parameters);
      if (requiredCheck.error) {
        setLastPreviewSignature(signatureAtRequest);
        setPreview({ status: "error", error: requiredCheck.error });
        setValidation({ status: "validated", valid: false, errors: [requiredCheck.error] });
        return;
      }
    }

    setPreview({ status: "loading" });
    setValidation({ status: "validating", valid: false, errors: [] });

    const [previewOutcome, validateOutcome] = await Promise.allSettled([
      previewBuildDetailed(spec, { limit: draft.previewLimit, sample_mode: draft.previewSampleMode }),
      validateSpec(spec),
    ]);

    if (requestId !== previewRequestIdRef.current) return;
    setLastPreviewSignature(signatureAtRequest);
    if (previewOutcome.status === "fulfilled") {
      setPreview({ status: "loaded", response: previewOutcome.value });
    } else {
      setPreview({
        status: "error",
        error: previewOutcome.reason instanceof Error
            ? previewOutcome.reason.message
            : i18n.t("addData.errors.preview"),
        missingKeys: missingProviderKeys(previewOutcome.reason) ?? undefined,
      });
    }

    if (requestId !== previewRequestIdRef.current) return;
    if (validateOutcome.status === "fulfilled") {
      setValidation({ status: "validated", valid: validateOutcome.value.valid, errors: validateOutcome.value.errors });
    } else {
      setValidation({
        status: "validated",
        valid: false,
        errors: [
          validateOutcome.reason instanceof Error
            ? validateOutcome.reason.message
            : i18n.t("addData.errors.validate"),
        ],
      });
    }
  }

  function saveCurrentDraft() {
    saveAddDataDraft(draft);
    setDraftSaved(true);
  }

  /**
   * Open this flow's own saved draft; a waiting Ask KPubData draft is the one not chosen.
   * The saved draft is read first: when it is unreadable it is removed, the Ask KPubData
   * draft stays offered and a notice says why nothing opened (#589).
   */
  function restoreSavedDraft() {
    const saved = loadAddDataDraft();
    if (!saved) {
      clearAddDataDraft();
      setWaitingDrafts((current) => ({ ...current, saved: false }));
      setCorruptDraft("saved");
      return;
    }
    if (waitingDrafts.ask) discardFormDraft();
    const kept = keepCurrentInput();
    setWaitingDrafts({ saved: kept, ask: false });
    setCorruptDraft(null);
    setDraft(saved);
  }

  /**
   * Before a draft replaces the form, keep what was typed as this flow's saved draft, so
   * opening a draft never throws input away; the banner then offers it back (#604).
   * Nothing is kept when the form is still empty.
   *
   * @returns Whether the input was kept.
   */
  function keepCurrentInput(): boolean {
    const hasInput = JSON.stringify(draft) !== JSON.stringify(INITIAL_DRAFT);
    if (hasInput) saveAddDataDraft(draft);
    setInputKept(hasInput);
    return hasInput;
  }

  /**
   * Open the Ask KPubData draft; a waiting saved draft of this flow is the one not chosen.
   * Like the saved draft, an unreadable Ask KPubData draft is removed without taking the
   * other one with it (#589).
   */
  function restoreAskDraft() {
    const result = takeFormDraftSpec();
    if (!result) {
      // loadDraft already removed the unreadable draft.
      setWaitingDrafts((current) => ({ ...current, ask: false }));
      setCorruptDraft("ask");
      return;
    }
    if (waitingDrafts.saved) clearAddDataDraft();
    const kept = keepCurrentInput();
    // A draft that did not become a spec stays in storage, but it is open now: not offered again.
    setWaitingDrafts({ saved: kept, ask: false });
    setCorruptDraft(null);
    setFormDraftError(null);
    openFormDraft(result);
  }

  /**
   * A draft that became a spec opens whole. One that could not keeps what the form can use
   * — provider, dataset, table id, title — and says why, so the parameters are typed again
   * instead of the draft vanishing.
   */
  function openFormDraft(result: FormDraftResult | null) {
    if (!result) return;
    if ("spec" in result) {
      applySpec(result.spec, INITIAL_DRAFT);
      return;
    }
    setDraft(draftFromFormValues(result.values));
    if (result.values.provider && result.values.sourceDataset) {
      lastIdentitySourceRef.current = `public_api:${result.values.provider}:${result.values.sourceDataset}`;
    }
    setFormDraftError(result.error);
  }

  function discardDraft() {
    setCorruptDraft(null);
    setInputKept(false);
    clearAddDataDraft();
    discardFormDraft();
    setWaitingDrafts({ saved: false, ask: false });
  }

  function discardFailedFormDraft() {
    discardFormDraft();
    setFormDraftError(null);
  }

  const specResult = buildSpecFromDraft(draft);
  const editableSpec = buildEditableSpecFromDraft(draft);
  const previewSources = preview.status === "loaded" ? preview.response.previews : [];

  // Adding a dataset whose id already has a table would replace that table (#837). The
  // review step asks Builder each time it is entered and whenever the id changes, and the
  // spec it shows and submits goes under a free id unless the user chose the same one.
  const requestedDatasetId = specResult.spec?.datasetId;
  // The source keys Builder's preview gave name the tables the build makes. From a stale
  // preview they are not the current ones, and the build is held anyway.
  const previewedSourceKeys = isStale ? "" : previewSources.map((source) => source.source_key).join("\n");
  useEffect(() => {
    if (step !== STEP_IDS.indexOf("create") || !requestedDatasetId) return;
    const controller = new AbortController();
    setExisting({ status: "checking" });
    setExistingChanged(false);
    setTableChoice("new");
    const sourceKeys = previewedSourceKeys === "" ? [] : previewedSourceKeys.split("\n");
    findExistingTables(requestedDatasetId, controller.signal, sourceKeys)
      .then(setExisting)
      .catch(() => {
        // Aborted: a newer question is on its way, or the step was left.
      });
    return () => controller.abort();
  }, [step, requestedDatasetId, previewedSourceKeys, existingAsked]);
  const specForBuild = specResult.spec ? specToBuild(specResult.spec, existing, tableChoice) : undefined;

  /**
   * Ask about the tables once more, and build only on the answer the review step showed
   * (#861). The answer on screen is as old as the step has been open; if another tab has
   * made a table under the free id since, this build would commit over it. A different
   * answer is shown instead of acted on: the user reads it and presses again.
   */
  async function buildOnTheAnswerShown() {
    if (!specForBuild || !requestedDatasetId || askingAgainRef.current) return;
    askingAgainRef.current = true;
    try {
      const sourceKeys = previewedSourceKeys === "" ? [] : previewedSourceKeys.split("\n");
      const now = await findExistingTables(requestedDatasetId, undefined, sourceKeys);
      if (!sameExistingTables(existing, now)) {
        setExisting(now);
        setExistingChanged(true);
        return;
      }
      setExistingChanged(false);
      // Started again after an attempt that failed here, it is a retry of that attempt
      // and says so (#757, #787).
      void job.start(specForBuild, { retryOf: retryOfFor(job.run) });
    } finally {
      askingAgainRef.current = false;
    }
  }

  // Build success (real-mode always uses actual run_id from Builder, mock-mode uses existing
  // mock path) → navigate to Builds/Runs. Don't create new mock run id — useBuildJob
  // already guarantees real run_id / mock-run distinction.
  useEffect(() => {
    if (job.status === "succeeded" && job.run) {
      clearAddDataDraft();
      // The Ask KPubData draft that could not open whole was kept for this table; it is done.
      if (formDraftError !== null) discardFormDraft();
      navigate(`/refresh-jobs/${encodeURIComponent(job.run.id)}`);
    }
  }, [job.status, job.run, navigate, formDraftError]);

  return (
    // Sticky bottom actions (Prev/Draft Save/Next, below) are sticky only on sm<, and even
    // while "pinned", preserve flow height so they float above last content during scroll
    // (390px width, UI audit #6-B) — short page heights can hide last field/button behind bar.
    // sm< only: add generous bottom margin (≈63px) so always fully scrollable to escape —
    // sm+ sticky becomes static (#6-B not applicable) so keep existing desktop margin.
    <div className="flex flex-1 flex-col gap-6 px-5 pt-8 pb-28 sm:px-8 sm:pb-8 lg:px-10 lg:pt-10 lg:pb-10">
      <PageHeader
        title={t("addData.page.title")}
        description={t("addData.page.desc")}
      />

      {openedSavedSpecName ? (
        <Card variant="dashed" className="p-4">
          <p className="text-sm text-foreground">{t("addData.savedSpecOpened", { name: openedSavedSpecName })}</p>
        </Card>
      ) : null}

      {waitingDrafts.saved && waitingDrafts.ask ? (
        <Card variant="dashed" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">{t("addData.draft.promptBoth")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={restoreSavedDraft}>{t("addData.draft.restoreSaved")}</Button>
            <Button size="sm" variant="secondary" onClick={restoreAskDraft}>{t("addData.draft.restoreAsk")}</Button>
            <Button size="sm" variant="ghost" onClick={discardDraft}>{t("addData.draft.discardAll")}</Button>
          </div>
        </Card>
      ) : waitingDrafts.saved || waitingDrafts.ask ? (
        <Card variant="dashed" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">{t("addData.draft.prompt")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={waitingDrafts.saved ? restoreSavedDraft : restoreAskDraft}>{t("addData.draft.restore")}</Button>
            <Button size="sm" variant="ghost" onClick={discardDraft}>{t("addData.draft.discard")}</Button>
          </div>
        </Card>
      ) : null}

      {corruptDraft !== null ? (
        <div role="status" className="rounded-xl border border-status-warning-border bg-status-warning-subtle p-4">
          <p className="text-sm text-foreground">
            {corruptDraft === "saved" ? t("addData.draft.savedCorrupt") : t("addData.draft.askCorrupt")}
          </p>
        </div>
      ) : null}

      {inputKept ? (
        <div role="status" className="rounded-xl border border-border bg-muted/50 p-4">
          <p className="text-sm text-foreground">{t("addData.draft.inputKept")}</p>
        </div>
      ) : null}

      {formDraftError !== null ? (
        <Card variant="error" role="alert" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 text-sm">
            <p className="font-medium">{t("addData.draft.openFailed", { error: formDraftError })}</p>
            <p>{t("addData.draft.reenterParams")}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={discardFailedFormDraft}>{t("addData.draft.discardKept")}</Button>
        </Card>
      ) : null}

      <Card>
        <Stepper
          label={t("addData.stepper.label")}
          steps={STEP_IDS.map((id) => ({ id, label: t(`addData.stepper.${id}`) }))}
          current={step}
          onStepClick={setStep}
        />
      </Card>

      <Card>
        <div ref={stepRegionRef}>
        {step === 0 ? <SourceStep selected={draft.sourceKind} onSelect={selectSource} /> : null}

        {step === 0 && draft.sourceKind ? (
          <div className="mt-6 border-t border-border pt-6">
            <ConfigureStep
              draft={draft}
              updateDraft={updateDraft}
              catalog={catalog}
              providerConfigured={providerConfigured}
              onConnectProvider={handleConnectProvider}
              upload={upload}
              onUploadFile={handleUploadFile}
              specError={specResult.error}
              // Show canonical spec drawable from current draft regardless of submit-readiness
              // (including sentinel fail-closed) (#283 follow-up review §3) — even if specResult.spec
              // is empty due to sentinel, YAML edit area must not disappear so user can replace
              // sentinel with real value and re-Apply.
              yamlText={editableSpec ? toYamlText(editableSpec) : ""}
              yamlEditError={yamlEditError}
              onApplyYaml={handleApplyYaml}
            />
          </div>
        ) : null}

        {step === 1 ? (
          <PreviewValidationStep
            preview={preview}
            limit={draft.previewLimit}
            sampleMode={draft.previewSampleMode}
            columns={draft.previewColumns}
            onChangeLimit={(limit: PreviewLimit) => updateDraft({ previewLimit: limit })}
            onChangeSampleMode={(mode: PreviewSampleMode) => updateDraft({ previewSampleMode: mode })}
            onChangeColumns={(columns: PreviewColumnView) => updateDraft({ previewColumns: columns })}
            onRefresh={() => void runPreviewAndValidate()}
            isStale={isStale}
            view={previewView}
            onChangeView={setPreviewView}
          />
        ) : null}

        {step === 2 ? (
          <ReviewBuildStep
            draft={draft}
            spec={specForBuild}
            specError={specResult.error}
            validation={validation}
            previewSources={previewSources}
            previewLimit={draft.previewLimit}
            previewSampleMode={draft.previewSampleMode}
            isStale={isStale}
            existing={existing}
            tableChoice={tableChoice}
            onChooseTable={setTableChoice}
            onRecheckExisting={() => setExistingAsked((asked) => asked + 1)}
            previewProblem={previewProblem(preview)}
            onBackToPreview={() => setStep(STEP_IDS.indexOf("preview"))}
            jobStatus={job.status}
            jobError={job.error}
            keyNotice={<BuildKeyNotice job={job} />}
            runId={job.run?.id}
            existingChanged={existingChanged}
            onBuild={() => void buildOnTheAnswerShown()}
            onCancel={job.cancel}
          />
        ) : null}
        </div>

        <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-8 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-6 py-3 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none sm:dark:bg-transparent">
          <Button variant="ghost" onClick={goBack} disabled={step === 0}>{t("addData.nav.back")}</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={saveCurrentDraft}>
              {draftSaved ? t("addData.nav.saved") : t("addData.nav.saveDraft")}
            </Button>
            {step < STEP_IDS.length - 1 ? <Button onClick={goNext}>{t("addData.nav.next")}</Button> : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
