/**
 * Add Data Workbench (`/add`, #250).
 *
 * Add Data → Source → Configure → Canonical BuildSpec → Preview & Validation → Review →
 * Build → Builds/Runs. Follows the 4-step wizard structure from Prototype
 * (kpubdata_ui_prototype_v1.html) (Source/Configure/Preview & Validate/Review & Build),
 * but actual values/state/limits/availability follow Builder contract.
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
import { checkCredentialPrerequisite, credentialPrerequisiteMessage } from "@/features/add-data/credentialPrerequisite";
import { ConfigureStep, type CatalogState, type UploadState } from "@/features/add-data/components/ConfigureStep";
import { PreviewValidationStep, type PreviewState } from "@/features/add-data/components/PreviewValidationStep";
import { ReviewBuildStep } from "@/features/add-data/components/ReviewBuildStep";
import { SourceStep } from "@/features/add-data/components/SourceStep";
import { clearAddDataDraft, hasAddDataDraft, loadAddDataDraft, saveAddDataDraft } from "@/features/add-data/draftStorage";
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
import type { SourceKind } from "@/shared/lib/types";
import { previewBuildDetailed } from "@/features/preview/api";
import { useBuildJob } from "@/features/runs/useBuildJob";
import { validateSpec } from "@/features/validation/api";
import { i18n } from "@/shared/i18n";
import { Button, Card, PageHeader, Stepper } from "@/shared/ui";

// Labels must follow screen language, so create at render time, not as constants.
const STEP_IDS = ["source", "configure", "preview", "review"] as const;


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
  const [draftAvailable, setDraftAvailable] = useState(() => hasAddDataDraft());
  const [draftSaved, setDraftSaved] = useState(false);
  const [lastPreviewSignature, setLastPreviewSignature] = useState<string | null>(null);

  const preselectApplied = useRef(false);
  // Ref storing the source identity key after last auto-sync (#250 final validation §1).
  // When source identity changes (provider+dataset/URL/file — real replacement, not
  // just detail config change), reset touched flags and force-apply new identity to
  // distinguish from detail config changes like query params/output/preview.
  const lastIdentitySourceRef = useRef<string | null>(null);
  const previewRequestIdRef = useRef(0);

  const updateDraft = useCallback((patch: Partial<AddDataDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

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
    const found = catalog.providers.find((p) => p.name === provider)?.datasets.find((d) => d.name === dataset);
    preselectApplied.current = true;
    if (!found) return;
    setDraft((current) => ({
      ...current,
      sourceKind: "public_api",
      publicApi: { ...current.publicApi, provider, dataset },
    }));
    setStep(1);
  }, [catalog, searchParams]);

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

  function goNext() {
    if (step === 0 && !draft.sourceKind) return;
    if (step === 1 && buildSpecFromDraft(draft).error) return;
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
      });
    }
  }

  function handleApplyYaml(text: string) {
    try {
      const spec = fromYamlText(text);
      // YAML Apply is explicit authoring (#250 amendment 2), so applyBuildSpecToDraft sets
      // all *Touched to true — but Public API/URL identity effects only check provider/dataset/
      // endpoint changes to judge "source changed", so if we don't sync lastIdentitySourceRef
      // to YAML's source first, they'll misfire as sourceChanged and overwrite just-set explicit
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
      setDraft((current) => applyBuildSpecToDraft(current, spec));
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
    const specResult = buildSpecFromDraft(draft);
    if (specResult.error || !specResult.spec) {
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
        const prerequisite = credentialPrerequisiteMessage();
        const message = `${prerequisite.title} — ${prerequisite.body.replace("\n", " ")}`;
        setPreview({ status: "error", error: message });
        setValidation({ status: "validated", valid: false, errors: [message] });
        return;
      }

      const requiredCheck = checkRequiredParams(draft.publicApi.sourceParams, selected?.request_parameters);
      if (requiredCheck.error) {
        setPreview({ status: "error", error: requiredCheck.error });
        setValidation({ status: "validated", valid: false, errors: [requiredCheck.error] });
        return;
      }
    }

    const signatureAtRequest = draftSignature(draft);
    setPreview({ status: "loading" });
    setValidation({ status: "validating", valid: false, errors: [] });

    const [previewOutcome, validateOutcome] = await Promise.allSettled([
      previewBuildDetailed(spec, { limit: draft.previewLimit, sample_mode: draft.previewSampleMode }),
      validateSpec(spec),
    ]);

    if (requestId !== previewRequestIdRef.current) return;
    if (previewOutcome.status === "fulfilled") {
      setPreview({ status: "loaded", response: previewOutcome.value });
      setLastPreviewSignature(signatureAtRequest);
    } else {
      setPreview({
        status: "error",
        error: previewOutcome.reason instanceof Error
            ? previewOutcome.reason.message
            : i18n.t("addData.errors.preview"),
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

  function restoreDraft() {
    const saved = loadAddDataDraft();
    if (!saved) {
      clearAddDataDraft();
      setDraftAvailable(false);
      return;
    }
    setDraft(saved);
    setDraftAvailable(false);
  }

  function discardDraft() {
    clearAddDataDraft();
    setDraftAvailable(false);
  }

  const specResult = buildSpecFromDraft(draft);
  const editableSpec = buildEditableSpecFromDraft(draft);
  const previewSources = preview.status === "loaded" ? preview.response.previews : [];

  // Build success (real-mode always uses actual run_id from Builder, mock-mode uses existing
  // mock path) → navigate to Builds/Runs. Don't create new mock run id — useBuildJob
  // already guarantees real run_id / mock-run distinction.
  useEffect(() => {
    if (job.status === "succeeded" && job.run) {
      clearAddDataDraft();
      navigate(`/refresh-jobs/${encodeURIComponent(job.run.id)}`);
    }
  }, [job.status, job.run, navigate]);

  return (
    // Sticky bottom actions (Prev/Draft Save/Next, below) are sticky only on sm<, and even
    // while "pinned", preserve flow height so they float above last content during scroll
    // (390px width, UI audit #6-B) — short page heights can hide last field/button behind bar.
    // sm< only: add generous bottom margin (≈63px) so always fully scrollable to escape —
    // sm+ sticky becomes static (#6-B not applicable) so keep existing desktop margin.
    <main className="flex flex-1 flex-col gap-6 px-5 pt-8 pb-28 sm:px-8 sm:pb-8 lg:px-10 lg:pt-10 lg:pb-10">
      <PageHeader
        eyebrow="Add Data"
        title={t("addData.page.title")}
        description={t("addData.page.desc")}
      />

      {draftAvailable ? (
        <Card variant="dashed" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">{t("addData.draft.prompt")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={restoreDraft}>{t("addData.draft.restore")}</Button>
            <Button size="sm" variant="ghost" onClick={discardDraft}>{t("addData.draft.discard")}</Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <Stepper
          steps={STEP_IDS.map((id) => ({ id, label: t(`addData.steps.${id}`) }))}
          current={step}
          onStepClick={setStep}
        />
      </Card>

      <Card>
        {step === 0 ? <SourceStep selected={draft.sourceKind} onSelect={selectSource} /> : null}

        {step === 1 ? (
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
        ) : null}

        {step === 2 ? (
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

        {step === 3 ? (
          <ReviewBuildStep
            draft={draft}
            spec={specResult.spec}
            specError={specResult.error}
            validation={validation}
            previewSources={previewSources}
            previewLimit={draft.previewLimit}
            previewSampleMode={draft.previewSampleMode}
            isStale={isStale}
            jobStatus={job.status}
            jobError={job.error}
            jobInterrupted={job.interrupted}
            runId={job.run?.id}
            onBuild={() => {
              if (specResult.spec) void job.start(specResult.spec);
            }}
            onCancel={job.cancel}
          />
        ) : null}

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
    </main>
  );
}
