/**
 * Run one read-only query against one table snapshot (#417).
 *
 * KPubData Engine's `POST /query` reads a single table — one run (the snapshot), one
 * stage, one source — as the relation `dataset`. Joining several tables waits for
 * kpubdata-builder#704. The person runs the query; nothing here runs one on its own.
 */
import { i18n } from "@/shared/i18n";
import { ApiError, builderApi, isRealBuilderEnabled, type QueryRequest, type QueryResponse } from "@/shared/lib/builderApi";
import { queryErrorResponseSchema } from "@/shared/lib/builderApi.schema";

export type QueryOutcome =
  | { status: "success"; result: QueryResponse; demo: boolean }
  | { status: "error"; code: string; message: string };

/** Fixed rows for mock mode — labelled demo on screen, never presented as real. */
const DEMO_RESULT: QueryResponse = {
  columns: ["station_name", "avg_pm10"],
  rows: [
    // i18n-ignore: demo row data (a place name), not UI text.
    { station_name: "종로구", avg_pm10: 31.5 },
    // i18n-ignore: demo row data (a place name), not UI text.
    { station_name: "중구", avg_pm10: 28 },
    // i18n-ignore: demo row data (a place name), not UI text.
    { station_name: "강남구", avg_pm10: 26.2 },
  ],
  truncated: false,
  execution_ms: 0,
};

export async function runTableQuery(request: QueryRequest, signal?: AbortSignal): Promise<QueryOutcome> {
  if (!isRealBuilderEnabled()) return { status: "success", result: DEMO_RESULT, demo: true };
  try {
    return { status: "success", result: await builderApi.query(request, signal), demo: false };
  } catch (cause) {
    if (cause instanceof ApiError) {
      const parsed = queryErrorResponseSchema.safeParse(cause.details);
      if (parsed.success) return { status: "error", code: parsed.data.code ?? "unknown", message: parsed.data.error };
      return { status: "error", code: cause.status === 0 ? "network" : "unknown", message: cause.message };
    }
    return {
      status: "error",
      code: "unknown",
      message: cause instanceof Error ? cause.message : i18n.t("sql.errors.unknown"),
    };
  }
}
