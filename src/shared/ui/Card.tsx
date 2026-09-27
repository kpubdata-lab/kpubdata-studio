/**
 * 공통 Card 컴포넌트.
 *
 * repeated `rounded-[2rem] border ... bg-white/80 shadow-l across pagesg` 패턴을
 * variant로 통일한다.
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
    "border border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30",
  success:
    "border border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
};

/**
 * render card container with standard padding and corners.
 *
 * @param props - standard div props plus variant.
 * @returns 카드 엘리먼트.
 */
export function Card({ variant = "default", className, children, ...rest }: CardProps) {
  return (
    <div className={cn("rounded-xl p-6", VARIANT_CLASS[variant], className)} {...rest}>
      {children}
    </div>
  );
}
