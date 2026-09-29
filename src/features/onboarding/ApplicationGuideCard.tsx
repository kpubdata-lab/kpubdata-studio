/**
 * Where to apply, and what a key may spend (#412).
 *
 * Telling a user a source needs an application is not useful without the page where
 * the application is made. This lists every source dataset the catalogue marks as
 * needing one, grouped by that page, with the provider's daily cap beside it.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { loadCatalog } from "@/features/discover/api";
import { providerLabel } from "@/shared/lib/providerLabels";
import { Card, Disclosure, Skeleton } from "@/shared/ui";

import { buildApplicationGuide, type ApplicationGuide } from "./applicationGuide";

type State = { status: "loading" } | { status: "error" } | { status: "loaded"; guide: ApplicationGuide };

/** The catalogue already refuses other schemes; checked again because this becomes a link. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function ApplicationGuideCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal)
      .then((catalog) => setState({ status: "loaded", guide: buildApplicationGuide(catalog) }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  return (
    <Card aria-labelledby="application-guide-title" className="flex flex-col gap-4" role="region">
      <div>
        <h2 className="text-base font-semibold" id="application-guide-title">
          {t("provider.applications.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("provider.applications.desc")}</p>
      </div>

      {state.status === "loading" ? <Skeleton className="h-24 w-full" /> : null}
      {state.status === "error" ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {t("provider.applications.loadError")}
        </p>
      ) : null}

      {state.status === "loaded" ? (
        <>
          {state.guide.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("provider.applications.none")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t("provider.applications.colProvider")}</th>
                    <th className="px-3 py-2 font-semibold">{t("provider.applications.colDatasets")}</th>
                    <th className="px-3 py-2 font-semibold">{t("provider.applications.colQuota")}</th>
                    <th className="px-3 py-2 font-semibold">{t("provider.applications.colUsage")}</th>
                    <th className="px-3 py-2 font-semibold">{t("provider.applications.colApply")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.guide.groups.map((group) => (
                    <tr className="border-t border-border align-top" key={`${group.provider}-${group.url}`}>
                      <td className="px-3 py-2">{providerLabel(group.provider)}</td>
                      <td className="px-3 py-2">
                        <ul className="space-y-0.5">
                          {group.datasets.map((dataset) => (
                            <li key={dataset.name}>
                              {dataset.title} <span className="font-mono text-xs text-muted-foreground">{dataset.name}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-2">
                        <ul className="space-y-0.5">
                          {group.datasets.map((dataset) => (
                            <li key={dataset.name}>
                              {dataset.quota ?? (
                                <span className="text-muted-foreground">{t("provider.applications.unknown")}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground" title={t("provider.applications.usageNote")}>
                        {t("provider.applications.unknown")}
                      </td>
                      <td className="px-3 py-2">
                        {isWebUrl(group.url) ? (
                          <a
                            className="font-medium text-accent-subtle-foreground underline"
                            href={group.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {t("provider.applications.apply")}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">{t("provider.applications.unknown")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("provider.applications.usageNote")}</p>
          {state.guide.unknownCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("provider.applications.unknownCount", { count: state.guide.unknownCount })}
            </p>
          ) : null}
        </>
      ) : null}

      <Disclosure title={t("provider.applications.operationalTitle")}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("provider.applications.operational1")}</li>
          <li>{t("provider.applications.operational2")}</li>
          <li>{t("provider.applications.operational3")}</li>
        </ol>
      </Disclosure>
    </Card>
  );
}
