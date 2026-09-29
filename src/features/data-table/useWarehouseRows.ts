/**
 * Page through one warehouse table without the snapshot moving underneath (#499).
 *
 * `POST /warehouse/rows` (builder#815) resolves `current` to a snapshot once and names
 * it in the response. Every later page must ask for that snapshot id, not `current`
 * again — otherwise a refresh committed between page 1 and page 2 would splice two
 * snapshots into one listing, repeating or skipping rows. The pin is kept here and only
 * a new table or a new requested snapshot clears it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { builderApi, type WarehouseRowsRequest, type WarehouseRowsResponse } from "@/shared/lib/builderApi";

export const CURRENT_SNAPSHOT = "current";

/** The request for a page: the pinned snapshot once there is one, `current` before. */
export function rowsRequest(
  table: string,
  requested: string,
  pinned: string | null,
  offset: number,
  pageSize: number,
): WarehouseRowsRequest {
  return { table, snapshot: pinned ?? requested, offset, page_size: pageSize };
}

export type RowsState =
  | { status: "idle" }
  | { status: "loading"; page?: WarehouseRowsResponse }
  | { status: "ready"; page: WarehouseRowsResponse }
  | { status: "error"; message: string; page?: WarehouseRowsResponse };

type Fetch = (request: WarehouseRowsRequest, signal?: AbortSignal) => Promise<WarehouseRowsResponse>;

export function useWarehouseRows(
  table: string,
  requestedSnapshot: string = CURRENT_SNAPSHOT,
  pageSize = 50,
  fetchPage: Fetch = builderApi.warehouseRows,
) {
  const [state, setState] = useState<RowsState>({ status: "idle" });
  const pinned = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(
    async (offset: number) => {
      if (!table) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setState((previous) => ({ status: "loading", page: "page" in previous ? previous.page : undefined }));
      try {
        const page = await fetchPage(rowsRequest(table, requestedSnapshot, pinned.current, offset, pageSize), abort.signal);
        if (abort.signal.aborted) return;
        pinned.current ??= page.snapshot.snapshot_id;
        setState({ status: "ready", page });
      } catch (cause) {
        if (abort.signal.aborted) return;
        setState((previous) => ({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
          page: "page" in previous ? previous.page : undefined,
        }));
      }
    },
    [table, requestedSnapshot, pageSize, fetchPage],
  );

  // A different table or requested snapshot is a different listing: drop the pin.
  useEffect(() => {
    pinned.current = null;
    setState({ status: "idle" });
    return () => controller.current?.abort();
  }, [table, requestedSnapshot]);

  const page = "page" in state ? state.page : undefined;
  return {
    state,
    pinnedSnapshot: pinned.current,
    start: () => load(0),
    next: () => page?.page.next_offset != null && load(page.page.next_offset),
    previous: () => page && load(Math.max(0, page.page.offset - page.page.page_size)),
  };
}
