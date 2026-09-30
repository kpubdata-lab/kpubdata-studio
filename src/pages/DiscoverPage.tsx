/**
 * Discover screen (`/discover`, #249).
 *
 * Explores Builder's original provider/dataset catalog (`GET /catalog`) as a comparison table (#529)
 * with exact search and filters (provider, service key, application),
 * then passes selected items to Add Data Workbench (`/add`, #250). Distinct from:
 * - Natural language search (Assistant, #256)
 * - Already-built dataset list (Dataset Catalog, `/datasets`, #253)
 * Does not mix `/catalog` (original) and `/datasets` (build results).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";
import { useNavigate, useSearchParams } from "react-router-dom";
import { loadCatalog, loadCreatedTables } from "@/features/discover/api";
import { CatalogTable, type CreatedTables } from "@/features/discover/CatalogTable";
import {
  computeApplicationCount,
  computeProviderCounts,
  computeServiceKeyCount,
  createdTablesBySource,
  flattenCatalog,
  matchesApplicationFilter,
  matchesProviderFilter,
  matchesQuery,
  matchesServiceKeyFilter,
  uniqueProviders,
  type DiscoverEntry,
} from "@/features/discover/model";
import { providerLabel } from "@/shared/lib/providerLabels";
import { Button, Card, EmptyState, ErrorState, LinkButton, PageHeader, Skeleton, TextInput } from "@/shared/ui";

interface CatalogState {
  status: "loading" | "loaded" | "error";
  entries?: DiscoverEntry[];
  error?: string;
}

const selectClassName =
  "h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function DiscoverPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<CatalogState>({ status: "loading" });

  const load = useCallback(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    loadCatalog(controller.signal)
      .then((catalog) => setState({ status: "loaded", entries: flattenCatalog(catalog) }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: cause instanceof Error ? cause.message : i18n.t("discover.errors.catalog"),
        });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  // Which tables each source made — a second, independent read; its failure only blanks that column.
  const [created, setCreated] = useState<CreatedTables>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    loadCreatedTables(controller.signal)
      .then(({ tables, complete }) => setCreated({ status: "loaded", index: createdTablesBySource(tables), complete }))
      .catch(() => !controller.signal.aborted && setCreated({ status: "error" }));
    return () => controller.abort();
  }, []);

  const query = searchParams.get("q") ?? "";
  const provider = searchParams.get("provider") ?? "";
  const onlyRequiresKey = searchParams.get("key") === "1";
  const onlyRequiresApplication = searchParams.get("app") === "1";

  function updateParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next);
  }

  const entries = state.entries ?? [];
  const providerOptions = useMemo(() => uniqueProviders(entries), [entries]);
  const providerCounts = useMemo(() => computeProviderCounts(entries), [entries]);
  const serviceKeyCount = useMemo(() => computeServiceKeyCount(entries), [entries]);

  const applicationCount = useMemo(() => computeApplicationCount(entries), [entries]);

  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          matchesQuery(entry, query) &&
          matchesProviderFilter(entry, provider) &&
          matchesServiceKeyFilter(entry, onlyRequiresKey) &&
          matchesApplicationFilter(entry, onlyRequiresApplication),
      ),
    [entries, query, provider, onlyRequiresKey, onlyRequiresApplication],
  );

  function startWithDataset(entry: DiscoverEntry) {
    navigate(`/add?provider=${encodeURIComponent(entry.provider)}&dataset=${encodeURIComponent(entry.dataset.name)}`);
  }

  const hasActiveFilters = Boolean(query || provider || onlyRequiresKey || onlyRequiresApplication);

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader
        title={t("discover.page.title")}
        description={t("discover.page.desc")}
        actions={<LinkButton to="/add">{t("tableActions.create")}</LinkButton>}
      />

      <Card className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-56 flex-1 lg:max-w-[390px]">
            <label htmlFor="discover-search" className="sr-only">
              {t("discover.searchLabel")}
            </label>
            <TextInput
              id="discover-search"
              placeholder={t("discover.searchLabel")}
              value={query}
              onChange={(event) => updateParam("q", event.target.value)}
            />
          </div>
          <label className="min-w-56 flex-1 sm:flex-none">
            <span className="sr-only">{t("labels.provider")}</span>
            <select
              aria-label={t("labels.provider")}
              className={`w-full ${selectClassName}`}
              value={provider}
              onChange={(event) => updateParam("provider", event.target.value)}
            >
              <option value="">{t("discover.allProviders", { count: entries.length })}</option>
              {providerOptions.map((item) => (
                <option key={item} value={item}>
                  {t("discover.providerOption", { label: providerLabel(item), count: providerCounts.get(item) ?? 0 })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={onlyRequiresKey}
              onChange={(event) => updateParam("key", event.target.checked ? "1" : "")}
            />
            {t("discover.serviceKeyOnly", { count: serviceKeyCount })}
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={onlyRequiresApplication}
              onChange={(event) => updateParam("app", event.target.checked ? "1" : "")}
            />
            {t("discover.applicationOnly", { count: applicationCount })}
          </label>
          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={() => setSearchParams({})} className="ml-auto">
              {t("discover.resetFilters")}
            </Button>
          ) : null}
        </div>

        {state.status === "loading" ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : state.status === "error" ? (
          <ErrorState title={t("discover.errors.catalogTitle")} message={state.error} onRetry={load} />
        ) : entries.length === 0 ? (
          <EmptyState
            title={t("discover.empty.title")}
            description={t("discover.empty.desc")}
          />
        ) : visibleEntries.length === 0 ? (
          <EmptyState title={t("discover.noMatch.title")} description={t("discover.noMatch.desc")} />
        ) : (
          <CatalogTable created={created} entries={visibleEntries} onStart={startWithDataset} />
        )}

        {state.status === "loaded" ? (
          <p className="text-xs text-muted-foreground">{t("discover.shownCount", { count: visibleEntries.length })}</p>
        ) : null}
      </Card>
    </main>
  );
}
