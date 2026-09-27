/**
 * common PageHeader component.
 *
 * unify "eyebrow label + title + description + right action" pattern repeated at page top일한다.
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
}

/**
 * render page heading (label/title/description/action) in consistent layout.
 *
 * @param props - eyebrow/title/description/actions.
 * @returns 페이지 헤더 엘리먼트.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
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
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
