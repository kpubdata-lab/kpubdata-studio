/**
 * common FormField component.
 *
 * consistently layout label + help text + error message, connect for accessibility via control에
 * 연결할 id와 aria-describedby를 계산해 render-prop으로 넘긴다(제안 §8/§12.3).
 *
 * 사용 예:
 *   <FormField id="datasetId" label="데이터셋 ID" help="예: kma-daily-observations"
 *              error={errors.datasetId?.message}>
 *     {(field) => <TextInput {...register("datasetId")} {...field} />}
 *   </FormField>
 */
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { ErrorMessage } from "./ErrorMessage";

export interface FormFieldRenderProps {
  /** id of control (connected to label htmlFor) */
  id: string;
  /** combined aria-describedby value from help/error id (undefined if none) */
  "aria-describedby": string | undefined;
  /** whether there is an error */
  invalid: boolean;
}

export interface FormFieldProps {
  /** default id to connect control and label */
  id: string;
  /** field label (Korean) */
  label: string;
  /** auxiliary description like input format */
  help?: ReactNode;
  /** validation error message */
  error?: ReactNode;
  /** whether to show required marker (*) */
  required?: boolean;
  /** function that receives computed accessibility props and renders control */
  children: (field: FormFieldRenderProps) => ReactNode;
  /** additional className */
  className?: string;
}

/**
 * render form field wrapper with connected label/help/error and accessibility props.
 *
 * @param props - id/label/help/error/required/children.
 * @returns 폼 필드 엘리먼트.
 */
export function FormField({
  id,
  label,
  help,
  error,
  required,
  children,
  className,
}: FormFieldProps) {
  const { t } = useTranslation();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required ? (
          <>
            {/* visual asterisk hidden from assistive tech; screen reader reads '(required)'. */}
            <span aria-hidden="true" className="ml-0.5 text-red-600">
              *
            </span>
            <span className="sr-only">{t("formField.required")}</span>
          </>
        ) : null}
      </label>
      {children({ id, "aria-describedby": describedBy, invalid: Boolean(error) })}
      {help ? (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
      <ErrorMessage id={errorId}>{error}</ErrorMessage>
    </div>
  );
}
