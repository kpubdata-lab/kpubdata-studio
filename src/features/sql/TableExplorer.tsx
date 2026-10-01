/**
 * Warehouse table explorer for the SQL Workspace (#528): Table → Source → Column.
 *
 * The Builder contract's `WarehouseTable` has no provider field; its `logical_name` is
 * `<dataset_id>.<source_key>`, so the first level groups by that dataset id (the Table)
 * and the second lists its sources, rather than guessing a provider. Columns load lazily — one row page (`page_size: 1`, no count) of
 * the table's snapshot — only when a table is expanded.
 *
 * A WAI-ARIA tree with a roving tab stop: ↑/↓ move, → expands or enters, ← collapses or
 * leaves, Home/End jump, Enter/Space activate. Activating a table binds `dataset` to it;
 * activating a column inserts its identifier at the editor's cursor. Nothing here runs a
 * query.
 */
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { type ColumnWireInfo, type WarehouseTable } from "@/shared/lib/builderApi";
import { warehouseApi } from "./warehouseApi";
import { cn } from "@/shared/ui";

/** A column as listed: its name, and its logical type when the Builder described it. */
interface ExplorerColumn {
  name: string;
  type: string | null;
}

type Columns = { status: "loading" } | { status: "error" } | { status: "none" } | { status: "loaded"; columns: ExplorerColumn[] };

type Item =
  | { kind: "group"; id: string; level: 1; label: string; expanded: boolean }
  | { kind: "table"; id: string; level: 2; label: string; parent: string; table: string; expanded: boolean }
  | { kind: "column"; id: string; level: 3; label: string; parent: string; table: string; column: ExplorerColumn };

/** `<dataset_id>.<source_key>` split at the last dot; a name without one is its own group. */
function splitLogicalName(name: string): { group: string; leaf: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { group: name.slice(0, dot), leaf: name.slice(dot + 1) } : { group: name, leaf: name };
}

export function TableExplorer({
  tables,
  selectedTable,
  selectedSnapshot,
  onSelectTable,
  onInsertColumn,
}: {
  tables: WarehouseTable[];
  selectedTable: string;
  /** The snapshot the selected table is bound to; other tables list columns from `current`. */
  selectedSnapshot: string;
  onSelectTable: (table: string) => void;
  onInsertColumn: (table: string, column: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(() => new Set());
  const [columns, setColumns] = useState<Record<string, Columns>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLLIElement>());

  const groups = useMemo(() => {
    const byGroup = new Map<string, WarehouseTable[]>();
    for (const table of tables) {
      const { group } = splitLogicalName(table.logical_name);
      byGroup.set(group, [...(byGroup.get(group) ?? []), table]);
    }
    return [...byGroup.entries()];
  }, [tables]);

  const columnKey = (table: string) => `${table}@${table === selectedTable ? selectedSnapshot : "current"}`;

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const [group, members] of groups) {
      const groupId = `g:${group}`;
      const groupExpanded = !collapsedGroups.has(group);
      out.push({ kind: "group", id: groupId, level: 1, label: group, expanded: groupExpanded });
      if (!groupExpanded) continue;
      for (const table of members) {
        const name = table.logical_name;
        const tableId = `t:${name}`;
        const expanded = expandedTables.has(name);
        out.push({ kind: "table", id: tableId, level: 2, label: name, parent: groupId, table: name, expanded });
        const loaded = columns[`${name}@${name === selectedTable ? selectedSnapshot : "current"}`];
        if (expanded && loaded?.status === "loaded") {
          for (const column of loaded.columns) {
            out.push({ kind: "column", id: `c:${name}:${column.name}`, level: 3, label: column.name, parent: tableId, table: name, column });
          }
        }
      }
    }
    return out;
  }, [groups, collapsedGroups, expandedTables, columns, selectedTable, selectedSnapshot]);

  const tabStop = items.some((item) => item.id === activeId) ? activeId : (items[0]?.id ?? null);

  function focus(id: string | undefined) {
    if (!id) return;
    setActiveId(id);
    refs.current.get(id)?.focus();
  }

  function loadColumns(table: string) {
    const key = columnKey(table);
    if (columns[key] && columns[key].status !== "error") return;
    const meta = tables.find((item) => item.logical_name === table);
    const snapshot = table === selectedTable ? selectedSnapshot : "current";
    if (snapshot === "current" && !meta?.current_snapshot_id) {
      setColumns((prev) => ({ ...prev, [key]: { status: "none" } }));
      return;
    }
    setColumns((prev) => ({ ...prev, [key]: { status: "loading" } }));
    warehouseApi()
      .warehouseRows({ table, snapshot, page_size: 1, count: "none" })
      .then((page) => setColumns((prev) => ({ ...prev, [key]: { status: "loaded", columns: columnsOf(page.columns, page.column_meta) } })))
      .catch(() => setColumns((prev) => ({ ...prev, [key]: { status: "error" } })));
  }

  function setExpanded(item: Item, expanded: boolean) {
    if (item.kind === "group") {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (expanded) next.delete(item.label);
        else next.add(item.label);
        return next;
      });
    } else if (item.kind === "table") {
      setExpandedTables((prev) => {
        const next = new Set(prev);
        if (expanded) next.add(item.table);
        else next.delete(item.table);
        return next;
      });
      if (expanded) loadColumns(item.table);
    }
  }

  function activate(item: Item) {
    setActiveId(item.id);
    if (item.kind === "group") setExpanded(item, !item.expanded);
    else if (item.kind === "table") onSelectTable(item.table);
    else onInsertColumn(item.table, item.column.name);
  }

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, item: Item, index: number) {
    switch (event.key) {
      case "ArrowDown":
        focus(items[index + 1]?.id);
        break;
      case "ArrowUp":
        focus(items[index - 1]?.id);
        break;
      case "Home":
        focus(items[0]?.id);
        break;
      case "End":
        focus(items[items.length - 1]?.id);
        break;
      case "ArrowRight":
        if (item.kind !== "column" && !item.expanded) setExpanded(item, true);
        else if (item.kind !== "column" && items[index + 1]?.level === item.level + 1) focus(items[index + 1]?.id);
        break;
      case "ArrowLeft":
        if (item.kind !== "column" && item.expanded) setExpanded(item, false);
        else if (item.kind !== "group") focus(item.parent);
        break;
      case "Enter":
      case " ":
        activate(item);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function renderStatus(item: Extract<Item, { kind: "table" }>) {
    if (!item.expanded) return null;
    const state = columns[columnKey(item.table)];
    if (!state || state.status === "loaded") {
      return state?.status === "loaded" && state.columns.length === 0 ? <StatusLine>{t("sql.explorer.noColumns")}</StatusLine> : null;
    }
    if (state.status === "loading") return <StatusLine>{t("sql.explorer.loadingColumns")}</StatusLine>;
    if (state.status === "none") return <StatusLine>{t("sql.explorer.noSnapshot")}</StatusLine>;
    return <StatusLine>{t("sql.explorer.columnsError")}</StatusLine>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-semibold text-muted-foreground" id="sql-explorer-label">
        {t("sql.explorer.title")}
      </p>
      {tables.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("sql.explorer.empty")}</p>
      ) : (
        <ul
          aria-label={t("sql.explorer.title")}
          className="max-h-80 overflow-y-auto rounded-lg border border-border bg-background py-1 text-sm"
          role="tree"
        >
          {items.map((item, index) => (
            <Fragment key={item.id}>
              <li
                aria-expanded={item.kind === "column" ? undefined : item.expanded}
                aria-label={item.kind === "column" ? item.column.type ? `${item.column.name} (${item.column.type})` : item.column.name : item.label}
                aria-level={item.level}
                aria-selected={item.kind === "table" ? item.table === selectedTable : undefined}
                className={cn(
                  "flex min-h-8 cursor-pointer items-center gap-1.5 py-1 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring hover:bg-muted",
                  item.level === 1 ? "pl-2" : item.level === 2 ? "pl-5" : "pl-10",
                  item.kind === "table" && item.table === selectedTable && "bg-brand-subtle text-brand-text",
                )}
                data-kind={item.kind}
                onClick={() => activate(item)}
                onFocus={() => setActiveId(item.id)}
                onKeyDown={(event) => onKeyDown(event, item, index)}
                ref={(node) => {
                  if (node) refs.current.set(item.id, node);
                  else refs.current.delete(item.id);
                }}
                role="treeitem"
                tabIndex={item.id === tabStop ? 0 : -1}
                title={item.kind === "column" ? t("sql.explorer.insertHint") : item.kind === "table" ? item.table : undefined}
              >
                {item.kind === "column" ? (
                  <>
                    <span className="min-w-0 flex-1 break-all font-mono text-xs">{item.column.name}</span>
                    {item.column.type ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.column.type}</span> : null}
                  </>
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className="w-3 shrink-0 text-center text-xs text-muted-foreground"
                      onClick={(event) => {
                        if (item.kind !== "table") return;
                        event.stopPropagation();
                        setActiveId(item.id);
                        setExpanded(item, !item.expanded);
                      }}
                    >
                      {item.expanded ? "▾" : "▸"}
                    </span>
                    <span className={cn("min-w-0 flex-1 break-all font-mono", item.kind === "group" ? "text-xs font-semibold" : "text-xs")}>
                      {item.kind === "table" ? splitLogicalName(item.table).leaf : item.label}
                    </span>
                  </>
                )}
              </li>
              {item.kind === "table" ? renderStatus(item) : null}
            </Fragment>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("sql.explorer.hint")}</p>
    </div>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <li className="py-1 pl-10 pr-2 text-xs text-muted-foreground" role="none">
      {children}
    </li>
  );
}

/** Columns in `columns` order; a column the meta does not describe keeps its name only. */
function columnsOf(names: string[], meta: ColumnWireInfo[]): ExplorerColumn[] {
  return names.map((name) => ({ name, type: meta.find((item) => item.name === name)?.logical_type ?? null }));
}
