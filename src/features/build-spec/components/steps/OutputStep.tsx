/** Wizard step 5 — output format and path (#379). */
import { useTranslation } from "react-i18next";
import type { FieldErrors, UseFormRegister } from "react-hook-form";

import { i18n } from "@/shared/i18n";
import { exportFormatSchema } from "@/shared/lib/schemas";
import { FormField, TextInput } from "@/shared/ui";
import type { BuildFormValues } from "@/features/build-spec/newBuildModel";

const exportFormats = exportFormatSchema.options;

export interface OutputStepProps {
  register: UseFormRegister<BuildFormValues>;
  errors: FieldErrors<BuildFormValues>;
  /**
   * Where the build writes when the path is left empty — given only for a spec that was
   * submitted without one (#883). Add Data leaves the path out and Builder accepted that
   * spec, so running it again must not ask for a value it never had: the field is then
   * optional and says where an empty one goes. Without this the path is required.
   */
  pathWhenEmpty?: string;
}

export function OutputStep({ register, errors, pathWhenEmpty }: OutputStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold tracking-tight">{t("newBuild.output.title")}</h3>
      <fieldset>
        <legend className="text-sm font-medium text-foreground">{t("newBuild.output.formatsLabel")}</legend>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {exportFormats.map((format) => (
            <label
              key={format}
              className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3"
            >
              <input
                type="checkbox"
                value={format}
                className="h-4 w-4 accent-status-success"
                {...register("exportFormats", {
                  validate: (selected) =>
                    (selected?.length ?? 0) > 0 || i18n.t("newBuild.errors.outputRequired"),
                })}
              />
              <span className="text-sm font-medium capitalize">{format}</span>
            </label>
          ))}
        </div>
        {errors.exportFormats ? (
          <p role="alert" className="mt-2 text-sm text-status-failure">
            {errors.exportFormats.message}
          </p>
        ) : null}
      </fieldset>
      <FormField
        id="outputPath"
        label={t("newBuild.output.pathLabel")}
        required={pathWhenEmpty === undefined}
        help={pathWhenEmpty === undefined ? undefined : t("newBuild.output.pathWhenEmpty", { path: pathWhenEmpty })}
        error={errors.outputPath?.message}
      >
        {(field) => (
          <TextInput
            placeholder={pathWhenEmpty ?? "artifacts/builds/air-quality"}
            {...field}
            {...register("outputPath", {
              required: pathWhenEmpty === undefined ? i18n.t("newBuild.errors.outputPathRequired") : false,
            })}
          />
        )}
      </FormField>
    </div>
  );
}
