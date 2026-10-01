/**
 * A table's terms of use, as declared (builder#764): the licence and what kind it is, the
 * attribution, and the link to the licence's own terms.
 *
 * Shown on Table Detail without an export, and reused by the export panel, so both say the
 * same thing the same way. What is not declared is an explicit unknown, never a guess, and
 * the link is a link only when it is an http(s) URL. A KOGL type under `license: other` is
 * marked as KOGL, so it does not read like a standard SPDX licence; an SPDX identifier is
 * shown in monospace with its own `SPDX` mark.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn, Skeleton } from "@/shared/ui";
import { ActionableStatus, UnknownStatus } from "@/shared/ui/StatusState";

import { isSafeLicenceLink, licenceKind, type LicenceKind, type LicenceTerms } from "./terms";
import type { RunLicenceState } from "./useRunLicence";

const KIND_CLASS: Record<Exclude<LicenceKind, "undeclared">, string> = {
  spdx: "border-border text-muted-foreground",
  kogl: "border-brand-primary bg-brand-subtle text-brand-text",
  other: "border-border border-dashed text-muted-foreground",
};

function Row({ label, children, kind }: { label: string; children: ReactNode; kind?: LicenceKind }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground" data-licence-kind={kind}>
        {children}
      </dd>
    </div>
  );
}

function KindMark({ kind }: { kind: Exclude<LicenceKind, "undeclared"> }) {
  const { t } = useTranslation();
  return (
    <span className={cn("ml-2 inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 align-middle text-[11px] font-medium", KIND_CLASS[kind])}>
      {t(`licence.kind.${kind}`)}
    </span>
  );
}

function LicenceValue({ terms, kind }: { terms: LicenceTerms; kind: LicenceKind }) {
  const { t } = useTranslation();
  if (kind === "undeclared") return <UnknownStatus>{t("licence.undeclared")}</UnknownStatus>;
  const other = terms.license?.toLowerCase() === "other";
  // Under `other` the name is the licence; otherwise the identifier is, and a declared name follows it.
  const primary = other ? terms.license_name : terms.license;
  const secondary = other ? null : terms.license_name;
  return (
    <>
      {primary ? <span className="font-mono">{primary}</span> : <UnknownStatus>{t("licence.nameUndeclared")}</UnknownStatus>}
      {secondary ? <span className="text-muted-foreground"> · {secondary}</span> : null}
      <KindMark kind={kind} />
    </>
  );
}

function AttributionValue({ terms, kind }: { terms: LicenceTerms; kind: LicenceKind }) {
  const { t } = useTranslation();
  if (terms.attribution) return <span>{terms.attribution}</span>;
  // Every KOGL type requires attribution (ADR 0018): its absence needs someone to act.
  if (kind === "kogl") {
    return (
      <ActionableStatus axis={t("licence.labels.attribution")} tone="warning">
        {t("licence.attributionRequired")}
      </ActionableStatus>
    );
  }
  return <UnknownStatus>{t("licence.attributionUndeclared")}</UnknownStatus>;
}

function LinkValue({ link }: { link: string | null }) {
  const { t } = useTranslation();
  if (!link) return <UnknownStatus>{t("licence.linkUndeclared")}</UnknownStatus>;
  if (!isSafeLicenceLink(link)) {
    return (
      <>
        <span className="break-all font-mono text-xs" data-licence-link="text">
          {link}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{t("licence.linkUnsafe")}</span>
      </>
    );
  }
  return (
    <a className="break-all text-brand-text underline underline-offset-2" href={link} rel="noopener noreferrer" target="_blank">
      {link}
      <span className="sr-only"> {t("licence.opensInNewTab")}</span>
    </a>
  );
}

/** The declared terms: licence and its kind, attribution, and the link to its terms. */
export function LicenceSummary({ terms, className }: { terms: LicenceTerms; className?: string }) {
  const { t } = useTranslation();
  const kind = licenceKind(terms);
  return (
    <dl className={cn("grid gap-3 sm:grid-cols-3", className)}>
      <Row kind={kind} label={t("licence.labels.licence")}>
        <LicenceValue kind={kind} terms={terms} />
      </Row>
      <Row label={t("licence.labels.attribution")}>
        <AttributionValue kind={kind} terms={terms} />
      </Row>
      <Row label={t("licence.labels.link")}>
        <LinkValue link={terms.license_link} />
      </Row>
    </dl>
  );
}

/**
 * The terms of the BuildSpec `runId` used, with where they come from. While the spec is
 * loading a placeholder holds the place; when Builder cannot give it, the terms are unknown
 * and the reason is said.
 */
export function RunLicence({ runId, state, headingLevel = 2 }: { runId: string; state: RunLicenceState; headingLevel?: 2 | 3 | 4 }) {
  const { t } = useTranslation();
  const Heading = `h${headingLevel}` as const;
  return (
    <section aria-label={t("licence.title")}>
      <Heading className="text-sm font-semibold">{t("licence.title")}</Heading>
      {!runId ? (
        <p className="mt-2 text-sm">
          <UnknownStatus>{t("licence.unavailable.noRun")}</UnknownStatus>
        </p>
      ) : state.status === "loaded" ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">{t("licence.source", { run: runId })}</p>
          <LicenceSummary className="mt-3" terms={state.terms} />
        </>
      ) : state.status === "unavailable" ? (
        <p className="mt-2 text-sm">
          <UnknownStatus>
            {state.reason === "error" ? t("licence.unavailable.error", { message: state.message }) : t(`licence.unavailable.${state.reason}`)}
          </UnknownStatus>
        </p>
      ) : (
        <Skeleton className="mt-3 h-10 w-full" />
      )}
    </section>
  );
}
