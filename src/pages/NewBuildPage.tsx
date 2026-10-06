/**
 * Edit an existing table's spec (`/refresh-jobs/:buildId/edit`).
 *
 * Guides through step-by-step Stepper instead of a single form (proposal §5.2):
 * Identity → Source → Params → Preview → Output → Review & Run. Manages input with
 * React Hook Form and validates only the fields for the current step before advancing.
 * Preview/Validate are not separate pages but integrated as wizard steps (§5.3/§5.4).
 *
 * Creating a table is `/add` (#534): this page used to be a second creation wizard at
 * `/refresh-jobs/new`, with templates, a draft slot and Workspace saved specs. Those moved
 * to the one creation flow; what stays is editing, which keeps what the form cannot
 * express from the opened spec (#496). Reached without a table, it sends the person to
 * `/add`.
 */
import { useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useParams } from "react-router-dom";
import { CREATE_TABLE_PATH } from "@/app/createTableRedirect";
import { previewBuild } from "@/features/preview/api";
import { useBuild } from "@/features/runs/useBuild";
import { retryOfFor } from "@/features/runs/api";
import { useBuildJob } from "@/features/runs/useBuildJob";
import { validateSpec } from "@/features/validation/api";
import { createSavedSpec } from "@/features/workspace/savedSpecs";
import type { SavedSpecValidation } from "@/features/workspace/types";
import { builderApi } from "@/shared/lib/builderApi";
import { providerLabel } from "@/shared/lib/providerLabels";
import type { BuildSpec } from "@/shared/lib/types";
import { Button, Card, PageHeader, StatusBadge, Stepper } from "@/shared/ui";

import {
  buildSteps,
  catalogProvider,
  editBlockReason,
  initialValues,
  toBuildSpec,
  toFormValues,
  STEP_FIELDS,
  type BuildFormValues,
  type CatalogState,
  type PreviewState,
  type ValidationState,
} from "@/features/build-spec/newBuildModel";
import { IdentityStep } from "@/features/build-spec/components/steps/IdentityStep";
import { OutputStep } from "@/features/build-spec/components/steps/OutputStep";
import { ParamsStep } from "@/features/build-spec/components/steps/ParamsStep";
import { PreviewStep } from "@/features/build-spec/components/steps/PreviewStep";
import { ReviewStep } from "@/features/build-spec/components/steps/ReviewStep";
import { SourceStep } from "@/features/build-spec/components/steps/SourceStep";
import { SpecRevisionPanel } from "@/features/build-spec/components/SpecRevisionPanel";
import { specRevisionDocId } from "@/features/build-spec/specRevisions";


/**
 * Spec edit page for the table behind `:buildId`.
 *
 * @returns Wizard UI, or a redirect to the creation flow when there is no table.
 */
export function NewBuildPage() {
  const { buildId } = useParams();
  if (!buildId) return <Navigate replace to={CREATE_TABLE_PATH} />;
  return <EditSpecWizard buildId={buildId} />;
}

function EditSpecWizard({ buildId }: { buildId: string }) {
  const { t } = useTranslation();
  const steps = buildSteps(t);
  const { build, isLoading: buildLoading } = useBuild(buildId);
  const isEditMode = build !== null;

  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle", rows: [], schema: {}, warnings: [] });
  const [validation, setValidation] = useState<ValidationState>({
    status: "idle",
    isValid: false,
    errors: [],
  });
  // Base spec being edited. Serves as reference to preserve sources/metadata that
  // the form cannot express.
  const [baseSpec, setBaseSpec] = useState<BuildSpec | null>(null);
  // Set when the opened spec has a first source the form cannot express (file/url, #496).
  // The wizard then stays closed instead of rebuilding that source as a public API one.
  const [editBlocked, setEditBlocked] = useState<string | null>(null);
  // The wizard shows once the opened spec is in the form, never an empty form first.
  const [formReady, setFormReady] = useState(false);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading", providers: [] });
  const [saveSpecMessage, setSaveSpecMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const job = useBuildJob();

  const {
    formState: { errors, isDirty },
    register,
    trigger,
    watch,
    getValues,
    reset,
    setValue,
  } = useForm<BuildFormValues>({ defaultValues: initialValues, mode: "onChange" });

  const values = watch();
  const specPreview = useMemo(() => toBuildSpec(values, baseSpec), [values, baseSpec]);
  const selectedProvider = values.provider;
  const providerOptions = catalog.providers.map((provider) => ({
    value: provider.name,
    label: providerLabel(provider.name),
  }));
  const datasetOptions = catalogProvider(catalog.providers, selectedProvider)?.datasets ?? [];

  // Snapshot of form input last validated. Used as comparison baseline to detect
  // when input changes after validation and reset validation status (prevent stale
  // validation, #72).
  const validatedSnapshotRef = useRef<string | null>(null);

  // After validation passes/completes, if watched form values change, reset validation
  // to idle/invalid to prevent unvalidated (modified) spec from running (#72).
  useEffect(() => {
    if (validation.status === "idle") return;
    const current = JSON.stringify(values);
    if (validatedSnapshotRef.current === null) {
      validatedSnapshotRef.current = current;
      return;
    }
    if (current !== validatedSnapshotRef.current) {
      validatedSnapshotRef.current = null;
      setValidation({ status: "idle", isValid: false, errors: [] });
    }
  }, [values, validation.status]);

  useEffect(() => {
    const controller = new AbortController();
    builderApi.catalog(controller.signal)
      .then((response) => {
        setCatalog({ status: "loaded", providers: response.providers });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setCatalog({
          status: "error",
          providers: [],
          error: cause instanceof Error ? cause.message : i18n.t("newBuild.errors.catalogFail"),
        });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (catalog.status !== "loaded" || selectedProvider === "") return;
    const datasets = catalogProvider(catalog.providers, selectedProvider)?.datasets ?? [];
    if (datasets.length === 0) return;
    if (datasets.some((dataset) => dataset.name === values.sourceDataset)) return;
    setValue("sourceDataset", datasets[0].name, { shouldDirty: true, shouldValidate: true });
  }, [catalog, selectedProvider, setValue, values.sourceDataset]);

  // Edit mode: load form when build is fetched.
  //
  // When the form is replaced, also clear preview/validation results
  // from the previous spec to prevent stale state (#72).
  useEffect(() => {
    if (!isEditMode || !build || buildLoading) return;
    setBaseSpec(build.spec);
    const blocked = editBlockReason(build.spec);
    setEditBlocked(blocked);
    setFormReady(true);
    if (blocked) return;
    reset(toFormValues(build.spec));
    setPreview({ status: "idle", rows: [], schema: {}, warnings: [] });
    setValidation({ status: "idle", isValid: false, errors: [] });
    validatedSnapshotRef.current = null;
    setStep(0);
  }, [isEditMode, build, buildLoading, reset]);

  // Revisions are kept under the table id of the spec that was opened (#649), so editing
  // the id in the form does not move the history.
  const revisionDocId = useMemo(() => (build ? specRevisionDocId(build.spec) : null), [build]);

  // A revision loaded from the history panel (latest, or a revert's result) replaces the
  // form the same way the opened spec did, and clears results of the previous spec (#72).
  function loadRevisionSpec(spec: BuildSpec) {
    setBaseSpec(spec);
    const blocked = editBlockReason(spec);
    setEditBlocked(blocked);
    if (blocked) return;
    reset(toFormValues(spec));
    setPreview({ status: "idle", rows: [], schema: {}, warnings: [] });
    setValidation({ status: "idle", isValid: false, errors: [] });
    validatedSnapshotRef.current = null;
  }

  const draftStatus = validation.isValid ? "validated" : isDirty ? "dirty" : "new";

  async function goNext() {
    const fields = STEP_FIELDS[step];
    const ok = fields.length === 0 ? true : await trigger(fields);
    if (!ok) return;
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 0));
  }

  async function runPreview() {
    const next = toBuildSpec(getValues(), baseSpec);
    if (next.error || !next.spec) {
      setPreview({ status: "error", rows: [], schema: {}, warnings: [], error: next.error });
      return;
    }
    setPreview({ status: "loading", rows: [], schema: {}, warnings: [] });
    try {
      const result = await previewBuild(next.spec);
      setPreview({
        status: "loaded",
        rows: result.rows,
        schema: result.schema,
        warnings: result.warnings.map((warning) => `${warning.sourceKey}: ${warning.error}`),
      });
    } catch (cause) {
      setPreview({
        status: "error",
        rows: [],
        schema: {},
        warnings: [],
        error: cause instanceof Error ? cause.message : i18n.t("newBuild.errors.previewFail"),
      });
    }
  }

  async function runValidate() {
    // Record snapshot of validation target input. If form changes after, effect detects
    // this and resets validation state (#72).
    validatedSnapshotRef.current = JSON.stringify(getValues());
    const next = toBuildSpec(getValues(), baseSpec);
    if (next.error || !next.spec) {
      setValidation({ status: "validated", isValid: false, errors: [next.error ?? i18n.t("newBuild.errors.specError")] });
      return;
    }
    setValidation({ status: "validating", isValid: false, errors: [] });
    try {
      const result = await validateSpec(next.spec);
      setValidation({ status: "validated", isValid: result.valid, errors: result.errors });
    } catch (cause) {
      // Expose network/5xx/parse failures as errors so UI can report them (prevent
      // unhandled rejection).
      setValidation({
        status: "validated",
        isValid: false,
        errors: [cause instanceof Error ? cause.message : i18n.t("newBuild.errors.validateFail")],
      });
    }
  }

  // Save current spec as Workspace (#260) Saved BuildSpec. Record validation state
  // at save time as-is — don't show unvalidated spec as "passed" (#72).
  function saveAsSavedSpec() {
    if (!specPreview.spec) return;
    const name = window.prompt(i18n.t("newBuild.review.savePrompt"), specPreview.spec.title || i18n.t("newBuild.review.unnamed"));
    if (!name) return;

    const validationSummary: SavedSpecValidation =
      validation.status === "validated"
        ? { status: validation.isValid ? "validated_pass" : "validated_fail", errors: validation.errors }
        : { status: "not_validated", errors: [] };

    const { result } = createSavedSpec({ name, spec: specPreview.spec, validation: validationSummary });
    setSaveSpecMessage(
      result.ok
        ? { type: "success", text: i18n.t("newBuild.review.savedAs", { name }) }
        : { type: "error", text: result.reason },
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        title={t("newBuild.page.titleEdit", { title: baseSpec?.title || buildId })}
        description={t("newBuild.page.descEdit")}
        actions={<StatusBadge status={draftStatus} />}
      />

      {buildLoading ? (
        <Card variant="dashed" className="p-4">
          <p className="text-sm text-muted-foreground">{t("newBuild.page.loadingSpec")}</p>
        </Card>
      ) : null}

      {!buildLoading && !isEditMode ? (
        <Card variant="dashed" className="p-4">
          <p className="text-sm text-foreground">
            {t("newBuild.page.specNotFound", { id: buildId })}
          </p>
        </Card>
      ) : null}

      {isEditMode ? (
        <Card variant="dashed" className="p-4">
          <p className="text-sm text-foreground">
            {t("newBuild.page.specEditing", { id: buildId })}
          </p>
        </Card>
      ) : null}

      {!isEditMode || !formReady ? null : editBlocked ? (
        <Card variant="dashed" className="p-4">
          <p role="alert" className="text-sm text-foreground">
            {editBlocked}
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <Stepper steps={steps} current={step} onStepClick={setStep} />
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.8fr)]">
            <Card>
              {step === 0 ? <IdentityStep register={register} errors={errors} /> : null}

              {step === 1 ? (
                <SourceStep
                  register={register}
                  errors={errors}
                  catalog={catalog}
                  providerOptions={providerOptions}
                  datasetOptions={datasetOptions}
                  selectedProvider={selectedProvider}
                />
              ) : null}

              {step === 2 ? <ParamsStep register={register} errors={errors} /> : null}

              {step === 3 ? <PreviewStep preview={preview} onRefresh={() => void runPreview()} /> : null}

              {step === 4 ? <OutputStep register={register} errors={errors} /> : null}

              {step === 5 ? (
                <ReviewStep
                  validation={validation}
                  job={job}
                  canRun={validation.isValid && job.status !== "running" && !!specPreview.spec}
                  canSave={!!specPreview.spec}
                  saveSpecMessage={saveSpecMessage}
                  onRevalidate={() => void runValidate()}
                  onRun={() => {
                    // A build started here from a run that failed or was cancelled is a
                    // retry of that run, and says so (#757).
                    if (specPreview.spec) void job.start(specPreview.spec, { retryOf: retryOfFor(build) });
                  }}
                  onSaveSpec={saveAsSavedSpec}
                  isRefresh
                />
              ) : null}

               {/* On mobile, pin bottom sticky action bar so Prev/Next are always visible
                   even in long forms (§13). */}
              <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-8 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-6 py-3 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none sm:dark:bg-transparent">
                <Button variant="ghost" onClick={goBack} disabled={step === 0}>
                  {t("newBuild.nav.prev")}
                </Button>
                {step < steps.length - 1 ? (
                  <Button onClick={() => void goNext()}>{t("newBuild.nav.next")}</Button>
                ) : null}
              </div>
            </Card>

            <aside className="space-y-5">
              <SpecRevisionPanel
                docId={revisionDocId}
                spec={specPreview.spec}
                onLoad={loadRevisionSpec}
              />
              <Card>
                 {/* On mobile, save space with collapsed details. On desktop (xl), shown in
                     separate column and expanded as needed (§13). */}
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("newBuild.nav.specTitle")}
                    <span className="text-base transition group-open:rotate-180" aria-hidden="true">
                      ⌄
                    </span>
                  </summary>
                  <pre className="mt-4 overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs leading-6 text-zinc-100">
                    <code>{JSON.stringify(specPreview.spec ?? values, null, 2)}</code>
                  </pre>
                </details>
              </Card>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

