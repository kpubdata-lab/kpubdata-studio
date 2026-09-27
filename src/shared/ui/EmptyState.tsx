/**
 * common EmptyState component.
 *
 * consistently express empty state with "what's missing + next action suggestion + CTA" structure (proposal §11).
 * CTA는 실제 동작(actionHref 또는 onAction)이 있을 때만 노출되며, 타입 차원에서도
 * actionLabel은 둘 중 하나와 함께만 지정할 수 있도록 제한한다.
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
 * show guidance text and (optional) next action CTA when data is empty.
 *
 * @param props - title/description/icon과 actionLabel+actionHref|onAction.
 * @returns 빈 상태 엘리먼트.
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
