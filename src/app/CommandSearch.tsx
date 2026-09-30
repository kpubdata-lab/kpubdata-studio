/**
 * Topbar search (#523): jump to a page, or search tables and the catalog by name.
 *
 * This is navigation, not AI. The topbar used to carry a search box that seeded a question
 * into Ask KPubData, so typing a table name started an LLM conversation. Search and the
 * assistant are now separate entry points: this dialog only moves the user to a page or
 * to the Tables / Catalog list filtered by the query (`?q=`), and Ask KPubData is its own
 * button. Opened with the button or ⌘K / Ctrl+K from anywhere.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";

export interface SearchDestination {
  /** Route to open */
  to: string;
  /** Page name as the sidebar shows it */
  label: string;
  /** What the page is for; matched as well as the label */
  description: string;
}

interface SearchResult {
  key: string;
  to: string;
  label: string;
  hint: string;
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

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

  const results = useMemo<SearchResult[]>(() => {
    const trimmed = query.trim();
    const needle = trimmed.toLowerCase();
    const pages = destinations
      .filter(
        (item) =>
          !needle ||
          item.label.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle),
      )
      .map((item) => ({ key: `page:${item.to}`, to: item.to, label: item.label, hint: t("layout.search.page") }));
    if (!trimmed) return pages;
    const params = new URLSearchParams({ q: trimmed }).toString();
    return [
      ...pages,
      { key: "tables", to: `/tables?${params}`, label: t("layout.search.inTables", { query: trimmed }), hint: t("nav.datasets") },
      { key: "catalog", to: `/discover?${params}`, label: t("layout.search.inCatalog", { query: trimmed }), hint: t("nav.discover") },
    ];
  }, [destinations, query, t]);

  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
    triggerRef.current?.focus();
  }

  function go(result: SearchResult | undefined) {
    if (!result) return;
    close();
    navigate(result.to);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
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
                className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-xl"
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
                <ul className="max-h-80 overflow-y-auto p-1" id={listId} role="listbox" aria-label={t("layout.search.dialog")}>
                  {results.map((result, index) => (
                    <li
                      aria-selected={index === active}
                      className={[
                        "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm",
                        index === active ? "bg-muted text-foreground" : "text-foreground",
                      ].join(" ")}
                      id={`${listId}-${index}`}
                      key={result.key}
                      onClick={() => go(result)}
                      onMouseEnter={() => setActive(index)}
                      role="option"
                    >
                      <span className="min-w-0 truncate">{result.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{result.hint}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
