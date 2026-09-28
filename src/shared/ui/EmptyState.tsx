/**
 * Common EmptyState component.
 *
 * Consistently express empty state with "what's missing + next action suggestion + CTA"
 * structure (proposal §11). CTA shown only when action actually exists (actionHref or
 * onAction); type constraints ensure actionLabel specified only with one of them.
 */
import type { ReactNode } from "react";
import { Button } from "./Button";
import { LinkButton } from "./LinkButton";
import { cn } from "./cn";

// actionLabel only allowed with actionHref (routing) or onAction (handler).
type EmptyStateAction =
  | { actionLabel: string; actionHref: string; onAction?: never }
  | { actionLabel: string; actionHref?: never; onAction: () => void }
  | { actionLabel?: never; actionHref?: never; onAction?: never };

export type EmptyStateProps = {
  /** title summarizing why empty */
  title: string;
  /** description of next action user can take */
  description?: ReactNode;
  /** top icon/illustration */
  icon?: ReactNode;
  /** additional className */
  className?: string;
} & EmptyStateAction;

/**
 * Show guidance text and (optional) next action CTA when data is empty.
 *
 * @param props - title/description/icon and actionLabel+actionHref|onAction.
 * @returns Empty state element.
 */
export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  icon,
  className,
}: EmptyStateProps) {
  const hasAction = Boolean(actionLabel) && (Boolean(actionHref) || Boolean(onAction));

  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {icon ? <div className="mb-4 text-muted-foreground">{icon}</div> : null}
      <p className="text-lg font-medium tracking-tight">{title}</p>
      {description ? (
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {hasAction ? (
        <div className="mt-6">
          {actionHref ? (
            <LinkButton to={actionHref} size="lg">
              {actionLabel}
            </LinkButton>
          ) : (
            <Button size="lg" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
