/**
 * Common Textarea component.
 *
 * Follows same style system as TextInput and uses forwardRef for react-hook-form ref
 * injection.
 */
import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** validation error state. If true, applies red border and aria-invalid. */
  invalid?: boolean;
  /** if true, apply monospace font (for code input like JSON). Default is body font. */
  mono?: boolean;
}

/**
 * multiline input control with styling and error state.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, mono, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground transition placeholder:text-muted-foreground",
        mono && "font-mono",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
        invalid
          ? "border-status-failure focus-visible:ring-status-failure"
          : "border-input focus-visible:ring-ring",
        className,
      )}
      {...rest}
    />
  );
});
