/** Wizard step 3 — request parameter (#379). */
import { useTranslation } from "react-i18next";
import type { FieldErrors, UseFormRegister } from "react-hook-form";

import { i18n } from "@/shared/i18n";
import { QueryParamsFields } from "@/features/build-spec/components/QueryParamsFields";
import { parseSourceParams } from "@/features/build-spec/paramsInput";
import { checkQueryParams } from "@/features/build-spec/queryParams";
import { FormField, Textarea } from "@/shared/ui";
import type { CatalogQueryParameter } from "@/shared/lib/builderApi";
import type { BuildFormValues } from "@/features/build-spec/newBuildModel";

export interface ParamsStepProps {
  register: UseFormRegister<BuildFormValues>;
  errors: FieldErrors<BuildFormValues>;
  /** The dataset's query definition (#899); null or absent when it has none, and only the JSON is shown. */
  queryParameters?: readonly CatalogQueryParameter[] | null;
  sourceParams?: string;
  onSourceParamsChange?: (text: string) => void;
}

export function ParamsStep({ register, errors, queryParameters, sourceParams, onSourceParamsChange }: ParamsStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold tracking-tight">{t("newBuild.params.title")}</h3>
      {queryParameters && queryParameters.length > 0 && sourceParams !== undefined && onSourceParamsChange ? (
        <QueryParamsFields
          idPrefix="sourceParams-field"
          parameters={queryParameters}
          text={sourceParams}
          onChange={onSourceParamsChange}
        />
      ) : null}
      <FormField
        id="sourceParams"
        label={queryParameters ? t("buildSpec.params.allLabel") : t("newBuild.params.label")}
        help={queryParameters ? t("buildSpec.params.allHelp") : t("newBuild.params.help")}
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
              validate: (value) => parseSourceParams(value).error ?? checkQueryParams(value, queryParameters) ?? true,
            })}
          />
        )}
      </FormField>
    </div>
  );
}
