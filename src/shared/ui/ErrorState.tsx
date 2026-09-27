/**
 * common ErrorState component (proposal §11).
 *
 * consistently express error state with "error cause + retry" structure. role="alert"로 보조기기에
 * 즉시 guidance하고, onRetry가 있으면 재시도 버튼을 노출한다.
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
 * show error cause and (optional) retry button.
 *
 * @param props - title/message/onRetry/retryLabel.
 * @returns 에러 상태 엘리먼트.
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
      <p className="text-lg font-medium tracking-tight text-red-700 dark:text-red-300">{resolvedTitle}</p>
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
