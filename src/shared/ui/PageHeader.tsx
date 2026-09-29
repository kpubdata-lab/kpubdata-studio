/**
 * Common PageHeader component.
 *
 * Unify "eyebrow label + title + description + right action" pattern repeated at
 * page top.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface PageHeaderProps {
  /** small uppercase label above title (e.g., "Runs") */
  eyebrow?: string;
  /** page title */
  title: string;
  /** auxiliary description below title */
  description?: ReactNode;
  /** right-aligned action area (buttons etc) */
  actions?: ReactNode;
  /** additional className */
  className?: string;
  /**
   * Heading level. A page's own header is its one `<h1>` (#485); a section inside a page
   * that reuses this layout passes 2.
   */
  level?: 1 | 2;
}

/**
 * Render page heading (label/title/description/action) in consistent layout.
 *
 * @param props - eyebrow/title/description/actions.
 * @returns Page header element.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  level = 1,
}: PageHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-subtle-foreground">
            {eyebrow}
          </p>
        ) : null}
        <Heading className="mt-2 text-3xl font-semibold tracking-tight">{title}</Heading>
        {description ? (
          <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
