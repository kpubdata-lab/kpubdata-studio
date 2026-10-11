/**
 * The inputs a dataset's query definition asks for (#899). Each field reads from and
 * writes into the request parameters' JSON text (`queryParams.ts`), so the JSON editor
 * beside it stays the full picture and the place for parameters the definition does not
 * list. An enum is a select; a typed parameter gets a matching input and a format check;
 * a parameter whose type is unknown is plain text, checked for nothing but `required`.
 */
import { useTranslation } from "react-i18next";

import {
  paramsObject,
  queryParamError,
  queryParamKey,
  readQueryParam,
  writeQueryParam,
} from "@/features/build-spec/queryParams";
import type { CatalogQueryParameter } from "@/shared/lib/builderApi";
import { FormField, Select, TextInput } from "@/shared/ui";

export interface QueryParamsFieldsProps {
  /** Prefix of each input's id, unique on the page. */
  idPrefix: string;
  parameters: readonly CatalogQueryParameter[];
  text: string;
  onChange: (text: string) => void;
}

const INPUT_MODES: Partial<Record<NonNullable<CatalogQueryParameter["type"]>, "numeric" | "decimal">> = {
  integer: "numeric",
  number: "decimal",
  date_yyyymmdd: "numeric",
  date_yyyymm: "numeric",
};

export function QueryParamsFields({ idPrefix, parameters, text, onChange }: QueryParamsFieldsProps) {
  const { t } = useTranslation();
  const params = paramsObject(text);

  return (
    <fieldset className="space-y-3" data-testid="query-params-fields">
      <legend className="text-sm font-semibold text-foreground">{t("buildSpec.params.fieldsTitle")}</legend>
      {params ? null : (
        <p role="alert" className="text-xs text-status-failure">{t("buildSpec.params.fieldsNeedJson")}</p>
      )}
      {parameters.map((param) => {
        const key = queryParamKey(param);
        const id = `${idPrefix}-${key}`;
        const value = params ? readQueryParam(params, param) : "";
        const error = params && value !== "" ? queryParamError(param, value) : undefined;
        const help = [
          param.alias ? t("buildSpec.params.providerName", { name: param.name }) : null,
          param.type ? t(`buildSpec.params.type.${param.type}`) : null,
          param.description,
        ]
          .filter(Boolean)
          .join(" · ");
        const set = (next: string) => onChange(writeQueryParam(text, param, next));
        return (
          <FormField key={key} id={id} label={key} required={param.required} help={help || undefined} error={error}>
            {(field) =>
              param.enum ? (
                <Select {...field} disabled={!params} value={value} onChange={(e) => set(e.target.value)}>
                  <option value="">{t("buildSpec.params.choose")}</option>
                  {/* A saved value the definition does not list stays visible, flagged by the check. */}
                  {value !== "" && !param.enum.includes(value) ? <option value={value}>{value}</option> : null}
                  {param.enum.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              ) : (
                <TextInput
                  {...field}
                  disabled={!params}
                  inputMode={param.type ? INPUT_MODES[param.type] : undefined}
                  placeholder={param.example ?? undefined}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              )
            }
          </FormField>
        );
      })}
    </fieldset>
  );
}
