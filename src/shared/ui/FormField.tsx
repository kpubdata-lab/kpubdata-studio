/**
 * Common FormField component.
 *
 * Consistently layout label + help text + error message, connected for accessibility
 * via computing id and aria-describedby values to pass to control via render-prop
 * (proposal §8/§12.3).
 *
 * Usage example:
 *   <FormField id="datasetId" label="Dataset ID" help="E.g. kma-daily-observations"
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
 * Render form field wrapper with connected label/help/error and accessibility props.
 *
 * @param props - id/label/help/error/required/children.
 * @returns Form field element.
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
