/**
 * Command palette (#523, #533): jump to a table, a source or a page from anywhere.
 *
 * This is navigation, not AI. Tables (`GET /datasets`) and catalog sources (`GET /catalog`)
 * are matched by name as the user types; pages match their sidebar label. When nothing
 * fits, the Tables and Catalog lists filtered by the query (`?q=`) are offered. Ask
 * KPubData appears only as the last option and is never the default one, so pressing
 * Enter on a search never starts a conversation. Opened with the button or ⌘K / Ctrl+K,
 * and usable with the keyboard alone.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";

import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { useUIStore } from "@/shared/hooks/useUIStore";

import {
  loadSourceEntries,
  loadTableEntries,
  matchSources,
  matchTables,
  type Loadable,
  type SourceEntry,
  type TableEntry,
} from "./commandSearchIndex";

export interface SearchDestination {
  /** Route to open */
  to: string;
  /** Page name as the sidebar shows it */
  label: string;
  /** What the page is for; matched as well as the label */
  description: string;
}

type GroupKey = "tables" | "sources" | "pages" | "filters" | "ask";

interface SearchResult {
  key: string;
  group: GroupKey;
  label: string;
  /** Identifier or kind shown on the right; identifiers are monospace. */
  hint: string;
  mono?: boolean;
  /** Route to open; absent for the Ask KPubData option. */
  to?: string;
}

const GROUP_ORDER: GroupKey[] = ["tables", "sources", "pages", "filters", "ask"];

/** Loads a list once, the first time the palette opens. */
function useLazyList<T>(enabled: boolean, load: (signal: AbortSignal) => Promise<T[]>): Loadable<T> {
  const [state, setState] = useState<Loadable<T> | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal)
      .then((items) => setState({ status: "loaded", items }))
      .catch(() => {
        if (controller.signal.aborted) return;
        // Let a later open try again.
        started.current = false;
        setState({ status: "error" });
      });
  }, [enabled, load]);

  return state ?? { status: "loading" };
}

function itemsOf<T>(list: Loadable<T>): T[] {
  return list.status === "loaded" ? list.items : [];
}

/**
 * Search button and its dialog.
 *
 * @param props.destinations - Pages the search can open (the sidebar's destinations).
 * @returns Topbar search trigger plus the dialog when open.
 */
export function CommandSearch({ destinations }: { destinations: SearchDestination[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);
  const seedQuestion = useAssistantStore((state) => state.seedQuestion);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const tables = useLazyList<TableEntry>(open, loadTableEntries);
  const sources = useLazyList<SourceEntry>(open, loadSourceEntries);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const trimmed = query.trim();

  const results = useMemo<SearchResult[]>(() => {
    const needle = trimmed.toLowerCase();
    const tableHits: SearchResult[] = matchTables(itemsOf(tables), trimmed).map((entry) => ({
      key: `table:${entry.datasetId}`,
      group: "tables",
      label: entry.title || entry.datasetId,
      hint: entry.datasetId,
      mono: true,
      to: `/tables/${encodeURIComponent(entry.datasetId)}`,
    }));
    const sourceHits: SearchResult[] = matchSources(itemsOf(sources), trimmed).map((entry) => ({
      key: `source:${entry.provider}.${entry.name}`,
      group: "sources",
      label: entry.title || entry.name,
      hint: `${entry.provider}.${entry.name}`,
      mono: true,
      to: `/discover?${new URLSearchParams({ provider: entry.provider, q: entry.name }).toString()}`,
    }));
    const pages: SearchResult[] = destinations
      .filter(
        (item) =>
          !needle ||
          item.label.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle),
      )
      .map((item) => ({ key: `page:${item.to}`, group: "pages", to: item.to, label: item.label, hint: t("layout.search.page") }));
    if (!trimmed) return pages;
    // The two list filters always sit between the hits and Ask KPubData, so the first
    // option — the one Enter picks before the user moves — is never Ask KPubData.
    const params = new URLSearchParams({ q: trimmed }).toString();
    return [
      ...tableHits,
      ...sourceHits,
      ...pages,
      { key: "filter:tables", group: "filters", to: `/tables?${params}`, label: t("layout.search.inTables", { query: trimmed }), hint: t("nav.datasets") },
      { key: "filter:catalog", group: "filters", to: `/discover?${params}`, label: t("layout.search.inCatalog", { query: trimmed }), hint: t("nav.discover") },
      { key: "ask", group: "ask", label: t("layout.search.ask", { query: trimmed }), hint: t("layout.search.askHint") },
    ];
  }, [destinations, sources, tables, t, trimmed]);

  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
    triggerRef.current?.focus();
  }

  function go(result: SearchResult | undefined) {
    if (!result) return;
    close();
    if (result.to) {
      navigate(result.to);
      return;
    }
    seedQuestion(trimmed);
    openAssistantDrawer();
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const last = results.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, last));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  const activeId = results[active] ? `${listId}-${active}` : undefined;
  const loading = trimmed !== "" && (tables.status === "loading" || sources.status === "loading");
  const failed = trimmed !== "" && (tables.status === "error" || sources.status === "error");

  const groupLabel: Record<GroupKey, string> = {
    tables: t("layout.search.groups.tables"),
    sources: t("layout.search.groups.sources"),
    pages: t("layout.search.groups.pages"),
    filters: t("layout.search.groups.filters"),
    ask: t("layout.search.groups.ask"),
  };

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        aria-label={t("layout.search.open")}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:min-w-56"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="hidden flex-1 text-left md:inline">{t("layout.search.button")}</span>
        <kbd className="hidden rounded border border-border px-1.5 font-sans text-xs text-muted-foreground md:inline">
          {t("layout.search.shortcut")}
        </kbd>
      </button>

      {/* Portalled: the sticky header has a backdrop filter, which would make it the
          containing block of a fixed overlay and clip the dialog to the header. */}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
              <button
                aria-label={t("layout.search.close")}
                className="absolute inset-0 bg-zinc-950/45"
                onClick={close}
                tabIndex={-1}
                type="button"
              />
              <div
                aria-label={t("layout.search.dialog")}
                aria-modal="true"
                className="relative w-full max-w-[560px] overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-xl"
                role="dialog"
              >
                <input
                  aria-activedescendant={activeId}
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-expanded="true"
                  aria-label={t("layout.search.inputLabel")}
                  className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onInputKeyDown}
                  placeholder={t("layout.search.placeholder")}
                  ref={inputRef}
                  role="combobox"
                  type="text"
                  value={query}
                />
                <ul aria-label={t("layout.search.dialog")} className="max-h-[min(24rem,60vh)] overflow-y-auto p-1" id={listId} role="listbox">
                  {GROUP_ORDER.map((group) => {
                    const members = results
                      .map((result, index) => ({ result, index }))
                      .filter(({ result }) => result.group === group);
                    if (members.length === 0) return null;
                    const headingId = `${listId}-${group}`;
                    return (
                      <li key={group} role="presentation">
                        {group === "ask" ? <div aria-hidden="true" className="mx-2 my-1 border-t border-border" /> : null}
                        <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground" id={headingId}>
                          {groupLabel[group]}
                        </div>
                        <ul aria-labelledby={headingId} role="group">
                          {members.map(({ result, index }) => {
                            const selected = index === active;
                            return (
                              <li
                                aria-selected={selected}
                                className={[
                                  "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-foreground",
                                  selected ? "bg-muted" : "",
                                ].join(" ")}
                                id={`${listId}-${index}`}
                                key={result.key}
                                onClick={() => go(result)}
                                onMouseEnter={() => setActive(index)}
                                role="option"
                              >
                                <span className="min-w-0 truncate">{result.label}</span>
                                <span className={["min-w-0 shrink truncate text-xs text-muted-foreground", result.mono ? "font-mono" : ""].join(" ")}>
                                  {result.hint}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
                {loading || failed ? (
                  <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground" role="status">
                    {loading ? t("layout.search.loading") : t("layout.search.loadFailed")}
                  </p>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
