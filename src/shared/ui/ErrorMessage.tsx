/**
 * common ErrorMessage component.
 *
 * expose form field or summary error as role="alert" for assistive tech immediate guidance하도록 한다
 * (접근성, 제안 §12).
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
 * render error message as role="alert". Render nothing if no children.
 *
 * @param props - id/children/className.
 * @returns 오류 metadata)시지 엘리먼트 또는 null.
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
