/**
 * Common ErrorMessage component.
 *
 * Expose form field or summary error as role="alert" for assistive tech immediate
 * guidance (accessibility, proposal §12).
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface ErrorMessageProps {
  /** id for connecting via aria-describedby */
  id?: string;
  /** error message body */
  children?: ReactNode;
  /** additional className */
  className?: string;
}

/**
 * Render error message as role="alert". Render nothing if no children.
 *
 * @param props - id/children/className.
 * @returns Error message element or null.
 */
export function ErrorMessage({ id, children, className }: ErrorMessageProps) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className={cn("text-sm text-red-600 dark:text-red-400", className)}
    >
      {children}
    </p>
  );
}
