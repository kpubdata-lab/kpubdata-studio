/**
 * Common PageHeader component.
 *
 * A compact header — title, optional metadata line, optional one-line description and a
 * right-aligned action area — so the object and the work area fill the first viewport
 * (#522). There is no eyebrow label above the title: the topbar breadcrumb already says
 * where the user is, and the page title is the largest text on screen (20px/600,
 * docs/brand/VISUAL_IDENTITY.md section 4).
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface PageHeaderProps {
  /** page title */
  title: string;
  /** short metadata under the title — identifiers, run ids, counts (12px) */
  meta?: ReactNode;
  /** optional one-line description; longer text is truncated */
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
 * Render the page heading (title/meta/description/actions) in a compact layout.
 *
 * @param props - title/meta/description/actions.
 * @returns Page header element.
 */
export function PageHeader({
  title,
  meta,
  description,
  actions,
  className,
  level = 1,
}: PageHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        <Heading
          className={cn(
            "break-words",
            level === 1 ? "text-page-title" : "text-sm font-semibold",
          )}
        >
          {title}
        </Heading>
        {meta ? (
          <p data-slot="page-meta" className="mt-0.5 break-words text-meta text-muted-foreground">
            {meta}
          </p>
        ) : null}
        {description ? (
          <p
            data-slot="page-description"
            className="mt-0.5 truncate text-sm text-muted-foreground"
            title={typeof description === "string" ? description : undefined}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
