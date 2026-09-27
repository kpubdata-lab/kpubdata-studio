/**
 * Minimal accessible disclosure (collapse/expand) pattern (#255 §3).
 *
 * Shows secondary evidence (like Run Events, BuildSpec snapshot — supplemental info that
 * does not replace core decision-making) as collapsed by default, but expandable via
 * keyboard/screen reader using only actual `<button>` + `aria-expanded`. Does not add
 * new accordion library.
 */
import { useId, useState, type ReactNode } from "react";

export interface DisclosureProps {
  /** title always visible when collapsed (only definite values like count, no guessing). */
  title: ReactNode;
   /** Whether initially expanded. Default false (collapsed) — don't use for primary info always visible. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/** simple disclosure with only button + aria-expanded. Renders children only when expanded. */
export function Disclosure({ title, defaultOpen = false, children, className }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-sm font-semibold"
      >
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          {open ? "▼" : "▶"}
        </span>
        {title}
      </button>
      {open ? (
        <div id={contentId} className="mt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
