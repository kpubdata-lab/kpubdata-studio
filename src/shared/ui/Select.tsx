/**
 * common Select component.
 *
 * unify selection input for Provider/Dataset/data unit etc. react-hook-form ref 주입을
 * 위해 forwardRef로 구현한다. 옵션은 children(<option>)으로 전달한다.
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
          ? "border-red-400 focus-visible:ring-red-500 dark:border-red-700"
          : "border-input focus-visible:ring-ring",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
