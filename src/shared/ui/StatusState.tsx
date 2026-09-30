/**
 * The five ways a status value reaches the screen (#524).
 *
 * A table that is mostly healthy should read as quiet text; only what needs a person's
 * action becomes a badge. And "Builder said unknown", "Builder sent nothing" and "nobody
 * evaluated this" are three different facts — they are never collapsed into one mark:
 *
 * | kind            | when                                   | DOM                                      |
 * |-----------------|----------------------------------------|------------------------------------------|
 * | `normal`        | a known, healthy value                 | plain text                               |
 * | `actionable`    | a known value that needs action        | bordered badge, axis + word              |
 * | `unknown`       | Builder sent the literal `unknown`     | muted text "Unknown" (read aloud)        |
 * | `missing`       | the field is absent from the response  | `—` + tooltip, screen reader gets words  |
 * | `not-evaluated` | nothing was evaluated                  | `N/A` as an abbreviation                 |
 *
 * `data-status` carries the kind so component tests can pin the meaning. Colour never
 * carries it alone: a badge always has its word, and its axis when there is one.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "./cn";

export type StatusKind = "normal" | "actionable" | "unknown" | "missing" | "not-evaluated";
export type ActionTone = "warning" | "failure";

const TONE_CLASS: Record<ActionTone, string> = {
  warning: "border-status-warning-border bg-status-warning-subtle text-status-warning",
  failure: "border-status-failure-border bg-status-failure-subtle text-status-failure",
};

/** A known value that needs no action: plain text, no colour. */
export function NormalStatus({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={className} data-status="normal">
      {children}
    </span>
  );
}

/** A known value that needs action: a badge with its axis (when there is one) and its word. */
export function ActionableStatus({
  axis,
  children,
  className,
  tone,
}: {
  axis?: ReactNode;
  children: ReactNode;
  className?: string;
  tone: ActionTone;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium", TONE_CLASS[tone], className)}
      data-status="actionable"
      data-tone={tone}
    >
      {axis ? <span className="opacity-80">{axis}</span> : null}
      <span>{children}</span>
    </span>
  );
}

/** Builder explicitly said `unknown`. Shown as a word, never as `—` or 0. */
export function UnknownStatus({ children, className }: { children?: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("text-status-unknown", className)} data-status="unknown">
      {children ?? t("statusState.unknown")}
    </span>
  );
}

/** The field is absent from Builder's response: a dash, with the reason in the tooltip. */
export function MissingStatus({ className, label }: { className?: string; label?: string }) {
  const { t } = useTranslation();
  const reason = t("statusState.missing");
  return (
    <span className={cn("text-muted-foreground", className)} data-status="missing" title={reason}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label ?? reason}</span>
    </span>
  );
}

/** Nothing was evaluated. `N/A` by default, expanded for screen readers and on hover. */
export function NotEvaluatedStatus({ children, className }: { children?: ReactNode; className?: string }) {
  const { t } = useTranslation();
  if (children !== undefined) {
    return (
      <span className={cn("text-muted-foreground", className)} data-status="not-evaluated">
        {children}
      </span>
    );
  }
  return (
    <abbr className={cn("text-muted-foreground no-underline", className)} data-status="not-evaluated" title={t("statusState.notEvaluated")}>
      N/A
    </abbr>
  );
}
