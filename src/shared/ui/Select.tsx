/**
 * Common Select component.
 *
 * Unify selection input for Provider/Dataset/data unit etc. Implemented with forwardRef
 * to allow react-hook-form ref injection. Options passed via children (<option>).
 */
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "./cn";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** validation error state. If true, applies red border and aria-invalid. */
  invalid?: boolean;
}

/**
 * select control with styling and error state.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
        invalid
          ? "border-status-failure focus-visible:ring-status-failure"
          : "border-input focus-visible:ring-ring",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
