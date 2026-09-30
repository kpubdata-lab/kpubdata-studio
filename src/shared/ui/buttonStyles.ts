/**
 * Visual style definition shared by Button and LinkButton.
 *
 * button and "link-looking button" share same variant/size look by combining
 * class logic in one place. This separation allows rendering links with button
 * styling without nesting `<a>` inside `<button>` (avoiding interaction nesting).
 */
import { cn, type ClassValue } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-foreground shadow-sm hover:brightness-110 active:brightness-95",
  secondary:
    "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "bg-status-failure-solid text-white shadow-sm hover:bg-status-failure-solid/90",
  success: "bg-status-success-solid text-white shadow-sm hover:bg-status-success-solid/90",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

/**
 * Generate button style className matching variant/size.
 *
 * @param variant - emphasis level.
 * @param size - button size.
 * @param extra - additional class values to compose.
 * @returns combined className string.
 */
export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  ...extra: ClassValue[]
): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    ...extra,
  );
}
