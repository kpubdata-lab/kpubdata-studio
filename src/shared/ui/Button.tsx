/**
 * Common Button component.
 *
 * Unified repeated Tailwind button styles across pages by variant/size/loading state.
 * Provides focus-visible ring and interaction blocking in disabled/loading states for accessibility.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "./buttonStyles";

export type { ButtonSize, ButtonVariant };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** variant that determines visual emphasis level */
  variant?: ButtonVariant;
  /** button size */
  size?: ButtonSize;
  /** loading state. If true, show spinner and prevent clicks. */
  loading?: boolean;
  /** icon etc to show before label */
  leadingIcon?: ReactNode;
}

/**
 * Render button with consistent styling and state.
 *
 * @param props - Standard button props plus variant/size/loading/leadingIcon.
 * @returns Button element.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  leadingIcon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={buttonClassName(
        variant,
        size,
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        leadingIcon
      )}
      {children}
    </button>
  );
}
