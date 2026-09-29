/**
 * Browse a warehouse table page by page, on one pinned snapshot (#499).
 */
import { useTranslation } from "react-i18next";

import { Button, Card } from "@/shared/ui";

import { DataTable, totalStatusOf } from "./DataTable";
import { useWarehouseRows } from "./useWarehouseRows";

export function TableRowsPanel({ table, snapshot }: { table: string; snapshot: string }) {
  const { t } = useTranslation();
  const rows = useWarehouseRows(table, snapshot);
  const { state } = rows;
  const page = "page" in state ? state.page : undefined;

  if (!page) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold">{t("dataTable.browseTitle")}</span>
        {state.status === "error" ? (
          <span className="text-sm text-red-700 dark:text-red-300" role="alert">
            {t("dataTable.browseError", { message: state.message })}
          </span>
        ) : null}
        <Button disabled={!table} loading={state.status === "loading"} onClick={() => void rows.start()} size="sm" variant="secondary">
          {t("dataTable.browse")}
        </Button>
      </Card>
    );
  }

  const { snapshot_id, logical_name, revision } = page.snapshot;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground" role="status">
        {t("dataTable.pinned", { snapshot: snapshot_id })}
      </p>
      {state.status === "error" ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {t("dataTable.browseError", { message: state.message })}
        </p>
      ) : null}
      <DataTable
        caption={
          <>
            <span className="font-mono">{`${logical_name}@${snapshot_id} · rev ${revision}`}</span>
            <span>·</span>
          </>
        }
        columnMeta={page.column_meta}
        columns={page.columns}
        compact
        paging={{
          offset: page.page.offset,
          hasMore: page.page.has_more,
          loading: state.status === "loading",
          onPrevious: () => void rows.previous(),
          onNext: () => void rows.next(),
        }}
        rowTotal={{ returned: page.page.returned, total: page.count.value, status: totalStatusOf(page.count.status) }}
        rows={page.rows}
      />
    </div>
  );
}
