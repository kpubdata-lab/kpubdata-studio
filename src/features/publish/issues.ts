/**
 * What each publish readiness/publish blocker means and what to do about it (#644, #639).
 *
 * Builder reports blockers as a stable `code` plus an English `message`
 * (`PublishIssue`). The contract lists every code it can send in `PublishIssue.code`'s
 * `x-codes` (kpubdata-builder#939/#943); this file keeps the same list so each one gets
 * a localized sentence and a next step. A code not listed here — a newer Builder's, or a
 * BuildSpec validation code the contract lets through — is shown as a generic blocker
 * with its code, as the contract asks clients to do.
 *
 * `__tests__/publishIssueCodes.test.ts` compares this list with the contract's `x-codes`
 * (when `BUILDER_CONTRACT` is set) and checks that every code has a ko and an en entry.
 */
import { i18n } from "@/shared/i18n";
import type { PublishIssue, RedistributionValue } from "@/shared/lib/builderApi";

/** Every `PublishIssue.code` in the contract's `x-codes` (builder contract 1.71.0). */
export const PUBLISH_ISSUE_CODES = [
  "run_not_terminal",
  "run_failed",
  "run_cancelled",
  "gold_unavailable",
  "artifact_missing",
  "artifact_invalid",
  "license_missing",
  "pii_allow_with_publish",
  "credential_unavailable",
  "credential_required",
  "local_publish_root_unconfigured",
  "destination_outside_publish_root",
  "kaggle_metadata_missing",
  "kaggle_metadata_ambiguous",
  "kaggle_metadata_unreadable",
  "kaggle_destination_mismatch",
  "redistribution_forbidden",
  "redistribution_unknown",
  "non_commercial_unconfirmed",
  "non_commercial_marker_missing",
  "destination_public",
  "destination_visibility_unknown",
  "card_missing",
  "card_incomplete",
] as const;

export type PublishIssueCode = (typeof PUBLISH_ISSUE_CODES)[number];

/** Blockers that come from the sources' redistribution terms (#688). */
export const REDISTRIBUTION_ISSUE_CODES: ReadonlySet<string> = new Set<PublishIssueCode>([
  "redistribution_forbidden",
  "redistribution_unknown",
  "non_commercial_unconfirmed",
  "non_commercial_marker_missing",
  "destination_public",
  "destination_visibility_unknown",
]);

/** A page the next step points to, resolved against the run by the publish page. */
export type PublishIssueLink = "editSpec" | "openRun" | "openArtifacts";

const ISSUE_LINKS: Partial<Record<PublishIssueCode, PublishIssueLink>> = {
  run_failed: "openRun",
  run_cancelled: "openRun",
  gold_unavailable: "openRun",
  artifact_missing: "openArtifacts",
  artifact_invalid: "openArtifacts",
  license_missing: "editSpec",
  pii_allow_with_publish: "editSpec",
  non_commercial_marker_missing: "editSpec",
  card_missing: "openRun",
  card_incomplete: "editSpec",
};

export interface PublishIssueDescription {
  /** Whether Studio knows this code; an unknown one is a generic blocker. */
  known: boolean;
  message: string;
  action: string;
  link?: PublishIssueLink;
}

const KNOWN: ReadonlySet<string> = new Set(PUBLISH_ISSUE_CODES);

export function isKnownPublishIssueCode(code: string): code is PublishIssueCode {
  return KNOWN.has(code);
}

/** The localized sentence and next step for a blocker; never echoes Builder's message. */
export function describePublishIssue(issue: Pick<PublishIssue, "code">): PublishIssueDescription {
  if (!isKnownPublishIssueCode(issue.code)) {
    return {
      known: false,
      message: i18n.t("publish.issues.unknown.message", { code: issue.code }),
      action: i18n.t("publish.issues.unknown.action"),
    };
  }
  return {
    known: true,
    message: i18n.t(`publish.issues.${issue.code}.message`),
    action: i18n.t(`publish.issues.${issue.code}.action`),
    link: ISSUE_LINKS[issue.code],
  };
}

/** Localized label of a redistribution verdict value. */
export function redistributionLabel(value: RedistributionValue): string {
  return i18n.t(`publish.redistribution.values.${value}`);
}
