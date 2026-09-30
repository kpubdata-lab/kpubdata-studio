/**
 * Common StatusBadge component.
 *
 * Displays every status value of the draft/run/publish flow in the four meanings of
 * #524: a value that needs no action is plain text (with a pulsing dot while it is in
 * progress), a value that needs action is a badge with its word, Builder's literal
 * `unknown` is the word "Unknown", and an absent status is `—` with the reason. Colour
 * never carries the meaning alone.
 */
import { useTranslation } from "react-i18next";

import { ActionableStatus, MissingStatus, NormalStatus, UnknownStatus, type ActionTone } from "./StatusState";

/** union of all status values displayable as badge across Studio */
export type StatusValue =
  | "new"
  | "draft"
  | "dirty"
  | "validated"
  | "invalid"
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "publishing"
  | "published";

/** Statuses that need a person's action, and how loudly. Everything else is plain text. */
const ACTIONABLE: Partial<Record<StatusValue, ActionTone>> = {
  dirty: "warning",
  invalid: "failure",
  failed: "failure",
};

const LIVE = new Set<string>(["running", "publishing", "cancelling"]);

function isStatusValue(value: string): value is StatusValue {
  return ["new", "draft", "dirty", "validated", "invalid", "queued", "running", "cancelling", "succeeded", "failed", "cancelled", "publishing", "published"].includes(value);
}

export interface StatusBadgeProps {
  /**
   * Status value to display.
   *
   * A known `StatusValue` gets its translated label. `"unknown"` is Builder's explicit
   * unknown; `undefined`, `null` or `""` means Builder sent no status. Any other string is
   * shown as-is (prevents a crash when a mapping is missing).
   */
  status: StatusValue | (string & {}) | null | undefined;
  /** additional className */
  className?: string;
}

/**
 * Render a status value in the current language and in its #524 meaning.
 *
 * @param props - status and additional className.
 * @returns Status element.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useTranslation();
  if (status === undefined || status === null || status === "") return <MissingStatus className={className} />;
  if (status === "unknown") return <UnknownStatus className={className} />;
  if (!isStatusValue(status)) return <NormalStatus className={className}>{status}</NormalStatus>;

  const label = t(`status.${status}`);
  const tone = ACTIONABLE[status];
  if (tone) {
    return (
      <ActionableStatus className={className} tone={tone}>
        {label}
      </ActionableStatus>
    );
  }
  return (
    <NormalStatus className={className}>
      {LIVE.has(status) ? (
        <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />
      ) : null}
      {label}
    </NormalStatus>
  );
}
