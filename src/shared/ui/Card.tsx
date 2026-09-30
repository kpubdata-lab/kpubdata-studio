/**
 * Common Card component.
 *
 * Unified repeated `rounded-[2rem] border ... bg-white/80 shadow-l across pages` pattern
 * using variants.
 */
import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type CardVariant = "default" | "elevated" | "dashed" | "error" | "success";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** visual variant of card */
  variant?: CardVariant;
}

const VARIANT_CLASS: Record<CardVariant, string> = {
  default:
    "border border-border bg-card shadow-sm",
  elevated:
    "border border-border bg-card shadow-md",
  dashed:
    "border border-dashed border-border bg-transparent",
  error:
    "border border-status-failure-border bg-status-failure-subtle",
  success:
    "border border-status-success-border bg-status-success-subtle",
};

/**
 * Render card container with standard padding and corners.
 *
 * @param props - Standard div props plus variant.
 * @returns Card element.
 */
export function Card({ variant = "default", className, children, ...rest }: CardProps) {
  return (
    <div className={cn("rounded-xl p-6", VARIANT_CLASS[variant], className)} {...rest}>
      {children}
    </div>
  );
}
