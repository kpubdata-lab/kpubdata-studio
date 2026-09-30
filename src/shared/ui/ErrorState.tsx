/**
 * Common ErrorState component (proposal §11).
 *
 * Consistently express error state with "error cause + retry" structure. Provides
 * immediate guidance to assistive tech via role="alert", and shows retry button if
 * onRetry present.
 */
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "./cn";

export interface ErrorStateProps {
  /** error title */
  title?: string;
  /** error cause/description */
  message?: ReactNode;
  /** retry handler (show button if present) */
  onRetry?: () => void;
  /** retry button label */
  retryLabel?: string;
  /** additional className */
  className?: string;
}

/**
 * Show error cause and (optional) retry button.
 *
 * @param props - title/message/onRetry/retryLabel.
 * @returns Error state element.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("errorState.title");
  const resolvedRetry = retryLabel ?? t("errorState.retry");
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <p className="text-lg font-medium tracking-tight text-status-failure">{resolvedTitle}</p>
      {message ? (
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {message}
        </p>
      ) : null}
      {onRetry ? (
        <div className="mt-6">
          <Button variant="secondary" onClick={onRetry}>
            {resolvedRetry}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
