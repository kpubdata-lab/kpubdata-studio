/**
 * common TextInput component.
 *
 * uses forwardRef to allow react-hook-form's register to inject ref 구현한다.
 * 오류 상태(invalid)에 따라 테두리 색과 focus 링을 바꾼다.
 */
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** validation error state. If true, applies red border and aria-invalid. */
  invalid?: boolean;
}

/**
 * text input control with styling and error state.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground transition placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
        invalid
          ? "border-red-400 focus-visible:ring-red-500 dark:border-red-700"
          : "border-input focus-visible:ring-ring",
        className,
      )}
      {...rest}
    />
  );
});
