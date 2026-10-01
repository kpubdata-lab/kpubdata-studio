/**
 * Catalog sources as a comparison table (#529): one row per source, so Provider, Access
 * and quota can be read down a column instead of across cards.
 *
 * Every cell comes from a Builder contract field. Format and supported operations are
 * `representation` and `operations` (#670), so a person sees before adding a source whether
 * it is an API call or a file and whether rows can be listed at all. `CatalogDataset` carries no institution
 * name, licence (KOGL) or maturity grade, so none is shown: maturity reads as unknown,
 * and no institution or licence is guessed (kpubdata#617, #644 will add them). Whatever
 * the contract leaves out reads as unknown (`—`), never as "no" or 0.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { providerLabel } from "@/shared/lib/providerLabels";
import { Button, cn } from "@/shared/ui";
import { NormalStatus, UnknownStatus } from "@/shared/ui/StatusState";

import { applicationState, sourceKey, type DiscoverEntry } from "./model";

export type CreatedTables =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; index: Map<string, string[]>; complete: boolean };

const badge = "inline-flex w-fit items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium";
const WARNING = "bg-status-warning-subtle text-status-warning";
const UNKNOWN = "bg-status-unknown-subtle text-status-unknown";
const NEUTRAL = "bg-muted text-muted-foreground";

function Unknown({ title }: { title: string }) {
  return (
    <span className="text-muted-foreground" title={title}>
      —
    </span>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground", className)} scope="col">
      {children}
    </th>
  );
}

function AccessCell({ entry }: { entry: DiscoverEntry }) {
  const { t } = useTranslation();
  const application = applicationState(entry);
  return (
    <div className="flex flex-col gap-1">
      <span className={cn(badge, entry.dataset.requires_service_key ? WARNING : NEUTRAL)}>
        {entry.dataset.requires_service_key ? t("discover.serviceKeyBadge") : t("discover.access.keyNotRequired")}
      </span>
      {application === "required" ? (
        <a
          className={cn(badge, WARNING, "underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
          href={entry.dataset.application?.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t("discover.access.applicationRequired")}
          <span className="sr-only"> {t("discover.access.newWindow")}</span>
          <span aria-hidden="true">&nbsp;↗</span>
        </a>
      ) : (
        <span className={cn(badge, application === "unknown" ? UNKNOWN : NEUTRAL)}>
          {application === "unknown" ? t("discover.access.applicationUnknown") : t("discover.access.applicationNotRequired")}
        </span>
      )}
    </div>
  );
}

/** `other` is a value Builder has not mapped: unknown, never a format of its own. */
function RepresentationCell({ entry }: { entry: DiscoverEntry }) {
  const { t } = useTranslation();
  const { representation } = entry.dataset;
  if (representation === "other") {
    return <UnknownStatus className="whitespace-nowrap">{t("discover.representation.other")}</UnknownStatus>;
  }
  return (
    <NormalStatus className="whitespace-nowrap text-foreground">
      <span title={representation}>{t(`discover.representation.${representation}`)}</span>
    </NormalStatus>
  );
}

/**
 * An empty list means Builder has no operation metadata for the source (the contract sends
 * an empty array when there is none), and an unmapped operation is left out — so empty reads as "no
 * information", never as "nothing can be done".
 */
function OperationsCell({ entry }: { entry: DiscoverEntry }) {
  const { t } = useTranslation();
  const { operations } = entry.dataset;
  if (operations.length === 0) {
    return <UnknownStatus className="whitespace-nowrap">{t("discover.operations.none")}</UnknownStatus>;
  }
  return (
    // A known value needs no action: plain text (StatusState `normal`), one operation a line.
    <ul className="flex flex-col gap-0.5 text-foreground" data-status="normal">
      {operations.map((operation) => (
        <li className="whitespace-nowrap" key={operation} title={operation}>
          {t(`discover.operations.${operation}`)}
        </li>
      ))}
    </ul>
  );
}

function CreatedTablesCell({ entry, created }: { entry: DiscoverEntry; created: CreatedTables }) {
  const { t } = useTranslation();
  if (created.status === "loading") return <span className="text-muted-foreground">{t("discover.created.loading")}</span>;
  if (created.status === "error") return <Unknown title={t("discover.created.errorTitle")} />;
  const ids = created.index.get(sourceKey(entry.provider, entry.dataset.name)) ?? [];
  if (ids.length === 0) {
    return created.complete ? <span className="text-muted-foreground">{t("discover.created.none")}</span> : <Unknown title={t("discover.created.incompleteTitle")} />;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {ids.map((id) => (
        <li key={id}>
          <Link className="break-all font-mono text-xs text-brand-text underline-offset-2 hover:underline" to={`/tables/${encodeURIComponent(id)}`}>
            {id}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CatalogTable({
  entries,
  created,
  onStart,
}: {
  entries: DiscoverEntry[];
  created: CreatedTables;
  onStart: (entry: DiscoverEntry) => void;
}) {
  const { t } = useTranslation();
  const caption = t("discover.table.caption");
  return (
    // The table is wider than a phone; it scrolls inside this region, never the page.
    // `relative` keeps the sr-only (absolutely positioned) text inside the scroll box too.
    <div
      aria-label={caption}
      className="relative max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[1080px] border-collapse text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <Th>{t("discover.columns.source")}</Th>
            <Th>{t("discover.columns.provider")}</Th>
            <Th>{t("discover.columns.representation")}</Th>
            <Th>{t("discover.columns.operations")}</Th>
            <Th>{t("discover.columns.access")}</Th>
            <Th>{t("discover.columns.maturity")}</Th>
            <Th>{t("discover.columns.createdTables")}</Th>
            <Th>{t("discover.columns.quota")}</Th>
            <Th className="text-right">{t("discover.columns.start")}</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr className="border-b border-border align-top last:border-b-0 hover:bg-muted/40" key={sourceKey(entry.provider, entry.dataset.name)}>
              <td className="px-3 py-2">
                <p className="font-medium text-foreground" title={entry.dataset.description ?? undefined}>
                  {entry.dataset.title}
                </p>
                <p className="break-all font-mono text-xs text-muted-foreground">{`${entry.provider}.${entry.dataset.name}`}</p>
              </td>
              <td className="px-3 py-2">
                <p className="text-foreground">{providerLabel(entry.provider)}</p>
                <p className="font-mono text-xs text-muted-foreground">{entry.provider}</p>
              </td>
              <td className="px-3 py-2">
                <RepresentationCell entry={entry} />
              </td>
              <td className="px-3 py-2">
                <OperationsCell entry={entry} />
              </td>
              <td className="px-3 py-2">
                <AccessCell entry={entry} />
              </td>
              <td className="px-3 py-2">
                <span className={cn(badge, UNKNOWN)} title={t("discover.maturityUnknownTitle")}>
                  {t("statusAxes.value.maturity.unknown")}
                </span>
              </td>
              <td className="px-3 py-2">
                <CreatedTablesCell created={created} entry={entry} />
              </td>
              <td className="px-3 py-2">
                {entry.dataset.quota ? (
                  <span className="text-foreground">{entry.dataset.quota}</span>
                ) : (
                  <Unknown title={t("discover.quotaUnknownTitle")} />
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {/* A squeezed column must not break the label one syllable a line (#698). */}
                <Button
                  aria-label={`${t("discover.startWith")} — ${entry.dataset.title}`}
                  className="whitespace-nowrap"
                  onClick={() => onStart(entry)}
                  size="sm"
                  variant="secondary"
                >
                  {t("discover.start")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
