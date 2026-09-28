/** Wizard step 3 — request parameter (#379). */
import { useTranslation } from "react-i18next";
import type { FieldErrors, UseFormRegister } from "react-hook-form";

import { i18n } from "@/shared/i18n";
import { parseSourceParams } from "@/features/build-spec/paramsInput";
import { FormField, Textarea } from "@/shared/ui";
import type { BuildFormValues } from "@/features/build-spec/newBuildModel";

export interface ParamsStepProps {
  register: UseFormRegister<BuildFormValues>;
  errors: FieldErrors<BuildFormValues>;
}

export function ParamsStep({ register, errors }: ParamsStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold tracking-tight">{t("newBuild.params.title")}</h3>
      <FormField
        id="sourceParams"
        label={t("newBuild.params.label")}
        help={t("newBuild.params.help")}
        error={errors.sourceParams?.message}
      >
        {(field) => (
          <Textarea
            mono
            rows={8}
            {...field}
            {...register("sourceParams", {
              required: i18n.t("newBuild.errors.paramsRequired"),
              // Block JSON syntax/object check at step move (trigger) point; display in field.
              validate: (value) => parseSourceParams(value).error ?? true,
            })}
          />
        )}
      </FormField>
    </div>
  );
}
