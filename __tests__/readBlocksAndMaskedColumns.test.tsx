/**
 * Policy blocks and masked PII on Builder reads (#640, #641; builder#688, #900).
 *
 * - A read Builder refuses because the source terms forbid redistribution, because a file
 *   holds declared PII unmasked, or because the PII declaration could not be read is a
 *   policy, not a failed query: the SQL workspace and the export say which one and what
 *   to do next, instead of "query failed" with Builder's English message.
 * - The columns Builder names in `masked_columns` (`/query` on Silver, `/preview`, a Silver
 *   stage detail) carry a header marker, and their mask tokens read as masked — never a
 *   column Builder did not name.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { PreviewValidationStep } from "@/features/add-data/components/PreviewValidationStep";
import { QueryResultView } from "@/features/assistant/AssistantContent";
import { DataTable } from "@/features/data-table/DataTable";
import { ExportPanel, describeRefusal } from "@/features/export/ExportPanel";
import { classifyQueryError } from "@/features/sql/api";
import { QueryError, ResultTable } from "@/features/sql/ResultTable";
import { queryWarehouse } from "@/features/sql/warehouse";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { API_BASE } from "@/shared/config/env";
import { i18n } from "@/shared/i18n";
import { ApiError } from "@/shared/lib/builderApi";
import {
  previewSourceSchema,
  queryErrorCodeSchema,
  queryErrorResponseSchema,
  queryResponseSchema,
  silverStageDetailResponseSchema,
  type PreviewSource,
  type QueryResponse,
} from "@/shared/lib/builderApi.schema";
import { hideDemoWarehouse } from "./support/noWarehouse";

// The Silver stage detail of the run-based Table Detail, with one masked column added.
vi.mock("@/features/datasets/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/datasets/api")>();
  return {
    ...actual,
    getBuildStageDetail: async (...args: Parameters<typeof actual.getBuildStageDetail>) => {
      const detail = await actual.getBuildStageDetail(...args);
      if (detail.stage !== "silver") return detail;
      return {
        ...detail,
        masked_columns: ["holder"],
        sample: detail.sample.map((row) => ({ ...row, holder: "[masked]" })),
      };
    },
  };
});

const t = i18n.t.bind(i18n) as unknown as (key: string, options?: Record<string, unknown>) => string;

/** Bodies as the contract's examples send them (builder-api.yaml, 1.70.0). */
const BODIES = {
  redistribution_forbidden: {
    status: 403,
    body: {
      error: "the source terms forbid redistribution, so query results cannot leave Builder",
      code: "redistribution_forbidden",
      redistribution: { verdict: "forbidden", sources: [{ source: "example.dataset", verdict: "forbidden", reason: "declared" }] },
    },
  },
  declared_pii_withheld: {
    status: 403,
    body: { error: "silver/x holds declared PII unmasked", code: "declared_pii_withheld", columns: ["resident_no", "phone"] },
  },
  pii_declaration_unavailable: {
    status: 503,
    body: {
      error: "the PII declaration of example.dataset could not be read",
      code: "pii_declaration_unavailable",
      dataset: "example.dataset",
    },
  },
} as const;
const BLOCK_CODES = Object.keys(BODIES) as Array<keyof typeof BODIES>;

describe("query error codes for policy blocks (#640)", () => {
  it.each(BLOCK_CODES)("queryErrorCodeSchema accepts %s and the contract body parses", (code) => {
    expect(queryErrorCodeSchema.safeParse(code).success).toBe(true);
    const parsed = queryErrorResponseSchema.safeParse(BODIES[code].body);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.code).toBe(code);
  });

  it.each(BLOCK_CODES)("classifyQueryError keeps %s", (code) => {
    const { status, body } = BODIES[code];
    expect(classifyQueryError(new ApiError(status, body.error, body))).toMatchObject({ status: "error", code });
  });

  it("a warehouse query refused for redistribution comes back as that code", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    try {
      mswServer.use(
        http.post(`${API_BASE}/warehouse/query`, () => HttpResponse.json(BODIES.redistribution_forbidden.body, { status: 403 })),
      );
      expect(await queryWarehouse("air", "snap-1", "SELECT 1")).toMatchObject({ status: "error", code: "redistribution_forbidden" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("QueryError explains each policy block and what to do next (#640)", () => {
  it.each(BLOCK_CODES)("%s has its own title and next action, not 'query failed'", (code) => {
    render(<QueryError code={code} message={BODIES[code].body.error} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-block", code);
    expect(alert).toHaveTextContent(t(`sql.blocked.${code}.title`));
    expect(alert).toHaveTextContent(t(`sql.blocked.${code}.next`));
    expect(alert).not.toHaveTextContent(t("sql.failed", { code }));
    // Builder's own words stay as the detail line.
    expect(alert).toHaveTextContent(BODIES[code].body.error);
  });

  it("the three blocks read differently", () => {
    const texts = BLOCK_CODES.map((code) => {
      const { unmount } = render(<QueryError code={code} message="m" />);
      const text = screen.getByRole("alert").textContent;
      unmount();
      return text;
    });
    expect(new Set(texts).size).toBe(3);
  });

  it("says what to do in Korean", () => {
    render(<QueryError code="pii_declaration_unavailable" message="m" />);
    expect(screen.getByRole("alert")).toHaveTextContent("개인정보 선언을 확인할 수 없어 안전을 위해 막았습니다");
    expect(screen.getByRole("alert")).toHaveTextContent("Gold 단계를 읽으세요");
  });

  it("a generic failure still says the query failed", () => {
    render(<QueryError code="query_timeout" message="timed out" />);
    expect(screen.getByRole("alert")).toHaveTextContent(t("sql.failed", { code: "query_timeout" }));
    expect(screen.getByRole("alert")).not.toHaveAttribute("data-block");
  });
});

describe("export refusals for policy blocks (#640)", () => {
  const refusal = (code: keyof typeof BODIES) => new ApiError(BODIES[code].status, BODIES[code].body.error, BODIES[code].body);

  it("redistribution_forbidden says the terms forbid it", () => {
    const text = describeRefusal(refusal("redistribution_forbidden"), t);
    expect(text).toBe(t("export.refused.redistribution"));
    expect(text).toContain("재배포를 금지");
  });

  it("declared_pii_withheld names the columns Builder sent", () => {
    const text = describeRefusal(refusal("declared_pii_withheld"), t);
    expect(text).toBe(t("export.refused.declaredPii", { columns: "resident_no, phone" }));
    expect(text).toContain("resident_no, phone");
  });

  it("declared_pii_withheld without columns still says why", () => {
    const text = describeRefusal(new ApiError(403, "x", { code: "declared_pii_withheld", error: "x" }), t);
    expect(text).toBe(t("export.refused.declaredPiiUnnamed"));
  });

  it("pii_declaration_unavailable names the dataset", () => {
    const text = describeRefusal(refusal("pii_declaration_unavailable"), t);
    expect(text).toBe(t("export.refused.piiDeclarationUnavailable", { dataset: "example.dataset" }));
    expect(text).toContain("example.dataset");
  });

  it.each(BLOCK_CODES)("%s is not the generic 'export failed'", (code) => {
    expect(describeRefusal(refusal(code), t)).not.toBe(t("export.refused.other", { message: BODIES[code].body.error }));
  });

  it("the export panel shows the redistribution refusal from Builder", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    try {
      mswServer.use(
        http.post(`${API_BASE}/warehouse/exports`, () => HttpResponse.json(BODIES.redistribution_forbidden.body, { status: 403 })),
      );
      render(<ExportPanel snapshot="snap-1" sql="SELECT 1" table="air" />);
      fireEvent.click(screen.getByRole("button", { name: t("export.create") }));
      expect(await screen.findByRole("alert")).toHaveTextContent(t("export.refused.redistribution"));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("masked_columns in the response schemas (#641)", () => {
  it("queryResponseSchema keeps masked_columns and leaves it absent when none", () => {
    const body = { columns: ["name"], rows: [{ name: "[masked]" }], truncated: false, execution_ms: 1, masked_columns: ["name"] };
    expect(queryResponseSchema.parse(body).masked_columns).toEqual(["name"]);
    const { masked_columns: _drop, ...without } = body;
    void _drop;
    expect(queryResponseSchema.parse(without).masked_columns).toBeUndefined();
  });

  it("previewSourceSchema keeps masked_columns", () => {
    const source = {
      source_key: "s",
      status: "ok",
      error: null,
      schema: [],
      sample: [],
      total_rows: 0,
      statistics: { row_count: 0, null_counts: {}, duplicate_rate: 0 },
      quality_results: [],
      source_sample: [],
      sample_mode: "first",
      diff_available: false,
      diffs: [],
      transform_summary: null,
      diff_truncated: false,
      masked_columns: ["phone"],
    };
    expect(previewSourceSchema.parse(source).masked_columns).toEqual(["phone"]);
  });

  it("silverStageDetailResponseSchema keeps masked_columns", () => {
    const detail = {
      run_id: "r",
      source_key: "s",
      status: "completed",
      available: true,
      stage: "silver",
      row_count: 1,
      schema: [],
      statistics: null,
      validation: null,
      sample: [{ phone: "[masked]" }],
      masked_columns: ["phone"],
    };
    expect(silverStageDetailResponseSchema.parse(detail).masked_columns).toEqual(["phone"]);
  });
});

const MASKED_ROWS = [
  { name: "[masked]", age: null, city: "Seoul", note: "[masked]" },
  { name: null, age: null, city: "Busan", note: "plain" },
];

describe("DataTable marks the columns Builder masked (#641)", () => {
  function renderTable(maskedColumns?: string[]) {
    return render(
      <DataTable
        columns={["name", "age", "city", "note"]}
        maskedColumns={maskedColumns}
        rowTotal={{ returned: 2, total: 2, status: "exact" }}
        rows={MASKED_ROWS}
      />,
    );
  }

  it("puts a badge on each masked column's header and nowhere else", () => {
    renderTable(["name", "age"]);
    const headers = screen.getAllByRole("columnheader");
    const marked = headers.filter((header) => header.querySelector("[data-masked-column]"));
    expect(marked.map((header) => header.querySelector(".font-mono")?.textContent)).toEqual(["name", "age"]);
    const badge = marked[0].querySelector("[data-masked-column]");
    expect(badge).toHaveTextContent(t("dataTable.masked.badge"));
    expect(badge).toHaveAttribute("title", t("dataTable.masked.explanation"));
    expect(screen.getByTestId("masked-note")).toHaveTextContent("name, age");
  });

  it("shows a mask token as masked, not as data, and explains a masked column's null", () => {
    renderTable(["name", "age"]);
    const first = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(first[0]).toHaveTextContent(t("dataTable.masked.value"));
    expect(first[0]).not.toHaveTextContent("[masked]");
    expect(first[0].querySelector("[data-masked-cell='token']")).toHaveAttribute("title", t("dataTable.masked.cellToken"));
    expect(first[1].querySelector("[data-masked-cell='null']")).toHaveAttribute("title", t("dataTable.masked.cellNull"));
  });

  it("does not guess: a column Builder did not name shows its text as sent", () => {
    renderTable(["name", "age"]);
    const first = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(first[3]).toHaveTextContent("[masked]");
    expect(first[3].querySelector("[data-masked-cell]")).toBeNull();
  });

  it("shows no marker when Builder named no column", () => {
    renderTable();
    expect(document.querySelector("[data-masked-column]")).toBeNull();
    expect(screen.queryByTestId("masked-note")).toBeNull();
    expect(within(screen.getAllByRole("row")[1]).getAllByRole("cell")[0]).toHaveTextContent("[masked]");
  });
});

describe("the SQL result and the Silver previews show the masked columns (#641)", () => {
  beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "false"));
  afterEach(() => vi.unstubAllEnvs());

  it("a Silver query result passes masked_columns to the table", () => {
    const result: QueryResponse = {
      columns: ["name", "city"],
      rows: [{ name: "[masked]", city: "Seoul" }],
      truncated: false,
      execution_ms: 3,
      masked_columns: ["name"],
    };
    render(<ResultTable result={result} target="air · silver" />);
    const header = screen.getAllByRole("columnheader").find((cell) => cell.textContent?.startsWith("name"));
    expect(header?.querySelector("[data-masked-column]")).not.toBeNull();
    expect(screen.getByTestId("masked-note")).toHaveTextContent("name");
  });

  it("the /preview sample marks the source's masked columns", () => {
    const source: PreviewSource = {
      source_key: "datago__air",
      status: "ok",
      error: null,
      schema: [
        { name: "holder", dtype: "string", nullable: true },
        { name: "city", dtype: "string", nullable: true },
      ] as PreviewSource["schema"],
      sample: [{ holder: "[masked]", city: "Seoul" }],
      total_rows: 1,
      statistics: { row_count: 1, null_counts: {}, duplicate_rate: 0 },
      quality_results: [],
      source_sample: [],
      sample_mode: "first",
      diff_available: false,
      diffs: [],
      transform_summary: null,
      diff_truncated: false,
      masked_columns: ["holder"],
    };
    render(
      <MemoryRouter>
        <PreviewValidationStep
          columns="all"
          limit={5}
          onChangeColumns={vi.fn()}
          onChangeLimit={vi.fn()}
          onChangeSampleMode={vi.fn()}
          onChangeView={vi.fn()}
          onRefresh={vi.fn()}
          preview={{ status: "loaded", response: { dataset_id: "d", previews: [source] } }}
          sampleMode="first"
          view="sample"
        />
      </MemoryRouter>,
    );
    const header = screen.getAllByRole("columnheader").find((cell) => cell.textContent?.startsWith("holder"));
    expect(header?.querySelector("[data-masked-column]")).not.toBeNull();
    expect(screen.getByText(t("dataTable.masked.value"))).toHaveAttribute("data-masked-cell", "token");
    expect(screen.getByTestId("masked-note")).toHaveTextContent("holder");
  });

  it("the Table Detail Silver preview marks the stage detail's masked columns", async () => {
    hideDemoWarehouse();
    render(
      <MemoryRouter initialEntries={["/tables/air-quality?stage=silver&tab=preview"]}>
        <Routes>
          <Route element={<DatasetDetailPage />} path="/tables/:datasetId" />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("2026-08-14T00:00:00Z")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("masked-note")).toHaveTextContent("holder"));
    const header = screen.getAllByRole("columnheader").find((cell) => cell.textContent?.includes("holder"));
    expect(header?.querySelector("[data-masked-column]")).not.toBeNull();
  });
});

describe("the assistant's query result reads the same blocks and masks (#640, #641)", () => {
  it("names a policy block in words, not as a translation key", () => {
    render(<QueryResultView query={{ status: "error", code: "redistribution_forbidden", message: "terms forbid" }} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(t("sql.blocked.redistribution_forbidden.title"));
    expect(alert).not.toHaveTextContent("sql.blocked");
  });

  it("translates the existing error labels too", () => {
    render(<QueryResultView query={{ status: "error", code: "query_timeout", message: "slow" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(t("assistant.queryError.query_timeout"));
  });

  it("marks a masked column of a Silver query", () => {
    render(
      <QueryResultView
        query={{
          status: "success",
          result: { columns: ["name"], rows: [{ name: "[masked]" }], truncated: false, execution_ms: 1, masked_columns: ["name"] },
        }}
      />,
    );
    expect(screen.getByRole("columnheader").querySelector("[data-masked-column]")).not.toBeNull();
    expect(screen.getByText(t("dataTable.masked.value"))).toHaveAttribute("data-masked-cell", "token");
  });
});
