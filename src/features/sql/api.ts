/**
 * Run one read-only query against one table snapshot (#417).
 *
 * KPubData Builder's `POST /query` reads a single table — one run (the snapshot), one
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
  columns: ["district", "avg_deal_amount"],
  rows: [
    // i18n-ignore: demo row data (a place name), not UI text.
    { district: "종로구", avg_deal_amount: 31.5 },
    // i18n-ignore: demo row data (a place name), not UI text.
    { district: "중구", avg_deal_amount: 28 },
    // i18n-ignore: demo row data (a place name), not UI text.
    { district: "강남구", avg_deal_amount: 26.2 },
  ],
  truncated: false,
  execution_ms: 0,
};

/** An Builder query error as `{code, message}` — the Builder's own code when it gave one. */
export function classifyQueryError(cause: unknown): { status: "error"; code: string; message: string } {
  if (cause instanceof ApiError) {
    const details = cause.details as { code?: unknown; error?: unknown } | undefined;
    // Said in the user's language with how long to wait (#949): the message the request layer made.
    if (details?.code === "query_rate_limited") return { status: "error", code: details.code, message: cause.message };
    const parsed = queryErrorResponseSchema.safeParse(details);
    if (parsed.success) return { status: "error", code: parsed.data.code ?? "unknown", message: parsed.data.error };
    if (details && typeof details.code === "string") {
      return { status: "error", code: details.code, message: typeof details.error === "string" ? details.error : cause.message };
    }
    return { status: "error", code: cause.status === 0 ? "network" : "unknown", message: cause.message };
  }
  return {
    status: "error",
    code: "unknown",
    message: cause instanceof Error ? cause.message : i18n.t("sql.errors.unknown"),
  };
}

/**
 * What the SQL workspace asks for (#902). Builder runs the query and its refusal is
 * classified; the demo answers every query with its fixed rows, marked `demo`.
 */
export interface SqlClient {
  runTableQuery(request: QueryRequest, signal?: AbortSignal): Promise<QueryOutcome>;
}

export const realSqlClient: SqlClient = {
  async runTableQuery(request, signal) {
    try {
      return { status: "success", result: await builderApi.query(request, signal), demo: false };
    } catch (cause) {
      return classifyQueryError(cause);
    }
  },
};

export const demoSqlClient: SqlClient = {
  runTableQuery: async () => ({ status: "success", result: DEMO_RESULT, demo: true }),
};

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function sqlClient(): SqlClient {
  return isRealBuilderEnabled() ? realSqlClient : demoSqlClient;
}

export async function runTableQuery(request: QueryRequest, signal?: AbortSignal): Promise<QueryOutcome> {
  return sqlClient().runTableQuery(request, signal);
}
