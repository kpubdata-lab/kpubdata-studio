/**
 * Results leave Studio only through KPubData Builder's exporter (#501, builder#819).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { ExportPanel } from "@/features/export/ExportPanel";
import { saveBlobAsFile } from "@/features/artifacts/api";
import { API_BASE } from "@/shared/config/env";
import { setAuthTokenProvider } from "@/shared/lib/builderApi";

// These talk to the Builder over HTTP (MSW); in mock mode the demo warehouse would answer (#530).
beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/features/artifacts/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/artifacts/api")>()),
  saveBlobAsFile: vi.fn(),
}));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A result file built in the browser: a CSV mime type or CSV-writing helper, or a Blob
 * made anywhere but the few places that wrap bytes Builder (or the report editor) wrote.
 */
const BLOB_ALLOWED = new Set(["src/features/reports/export.ts"]);
export function browserFileWriters(file: string, source: string): string[] {
  const hits: string[] = [];
  if (/text\/csv/.test(source)) hits.push(`${file}: text/csv`);
  if (/\b(toCsv|csvRow|csvEscape|toCSV|rowsToCsv)\b/.test(source)) hits.push(`${file}: CSV writer`);
  if (/new Blob\(/.test(source) && !BLOB_ALLOWED.has(file)) hits.push(`${file}: new Blob`);
  return hits;
}

describe("no browser-side result file (#501)", () => {
  it("no screen builds a CSV or a result Blob", () => {
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."));
    expect(files.flatMap((file) => browserFileWriters(file, readFileSync(join(ROOT, file), "utf8")))).toEqual([]);
  });

  it.each([
    ['const blob = new Blob([rows.join("\\n")], { type: "text/csv" });', 2],
    ["export function toCsv(rows) {}", 1],
    ["const b = new Blob([x]);", 1],
  ])("flags %s", (source, count) => {
    expect(browserFileWriters("src/features/sql/x.ts", source)).toHaveLength(count);
  });

  it("allows the report editor's markdown export and an accept list for uploads", () => {
    expect(browserFileWriters("src/features/reports/export.ts", "new Blob([content], { type: mimeType })")).toEqual([]);
    expect(browserFileWriters("src/features/add-data/x.tsx", 'accept=".csv,.json"')).toEqual([]);
  });
});

const EXPORT = {
  export_id: "exp_1",
  status: "completed",
  created_at: "2026-09-30T09:00:00Z",
  expires_at: "2026-10-01T09:00:00Z",
  request: { table: "air", snapshot: "current", sql: "SELECT * FROM dataset", format: "csv", profile: "spreadsheet", max_rows: 100000 },
  manifest: {
    manifest_version: 1,
    export_id: "exp_1",
    created_at: "2026-09-30T09:00:00Z",
    expires_at: "2026-10-01T09:00:00Z",
    query: { sql: "SELECT * FROM dataset", user_derived: true },
    snapshot: { table_id: "t", logical_name: "air", snapshot_id: "snap_7", revision: 4, run_id: "r1", artifact_digest: "sha256:x", row_count: 3, coverage: null },
    source: {
      dataset_id: "air",
      terms: { status: "declared", license: "KOGL-1", license_name: "공공누리 제1유형", license_link: null, attribution: "출처: 한국환경공단" },
      provenance: [],
    },
    output: {
      format: "csv",
      profile: "spreadsheet",
      encoding: "utf-8",
      bom: true,
      row_count: 3,
      completeness: "full",
      columns: [],
      values_altered: [{ column: "memo", count: 2, reason: "formula_prefix" }],
      file: { name: "air.csv", bytes: 10, sha256: "x" },
    },
    pii: { policy: null, allowed_findings: [] },
  },
  bundle: { filename: "exp_1.zip", media_type: "application/zip", bytes: 99, sha256: "y", files: ["air.csv", "manifest.json", "NOTICE.md"] },
  download_path: "/warehouse/exports/exp_1/download",
};

describe("the export panel asks Builder and shows its manifest (#501)", () => {
  it("pins table, snapshot and SQL, shows the concrete snapshot and terms, and downloads Builder's zip with the caller's token", async () => {
    const bodies: unknown[] = [];
    const auth: Array<string | null> = [];
    mswServer.use(
      http.post(`${API_BASE}/warehouse/exports`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(EXPORT);
      }),
      http.get(`${API_BASE}/warehouse/exports/exp_1/download`, ({ request }) => {
        auth.push(request.headers.get("Authorization"));
        return new HttpResponse("PK", { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="exp_1.zip"' } });
      }),
    );
    setAuthTokenProvider(() => "token-1");
    const save = vi.mocked(saveBlobAsFile);
    render(<ExportPanel snapshot="current" sql="SELECT * FROM dataset" table="air" />);
    fireEvent.change(screen.getByLabelText("용도"), { target: { value: "spreadsheet" } });
    expect(screen.getByText(/BOM 은 엑셀이 UTF-8 로 열게 할 뿐입니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "내보내기" }));
    await screen.findByText(/air@snap_7 · rev 4 을 읽었습니다/);
    expect(bodies[0]).toEqual({ table: "air", snapshot: "current", sql: "SELECT * FROM dataset", format: "csv", profile: "spreadsheet", max_rows: 100000 });
    expect(screen.getByText(/공공누리 제1유형 · 출처: 한국환경공단/)).toBeInTheDocument();
    expect(screen.getByText(/수집 범위: 기록 없음/)).toBeInTheDocument();
    expect(screen.getByText(/memo 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /번들 내려받기/ }));
    // The Blob comes from the fetch implementation, not jsdom, so compare the name only.
    await waitFor(() => expect(save.mock.calls.map((call) => call[1])).toEqual(["exp_1.zip"]));
    expect(auth).toEqual(["Bearer token-1"]);
    setAuthTokenProvider(null);
  });

  it.each([
    [{ code: "export_forbidden_by_license", message: "nd" }, /라이선스가 변경을 금지해/],
    [{ code: "export_blocked_pii", message: "pii", findings: [{ column: "phone", kind: "phone", count: 3 }] }, /phone \(phone, 3\)/],
    [{ code: "row_limit_exceeded", message: "too many", limit: 100000 }, /자르지 않으므로 아무것도 만들지 않았습니다/],
  ])("a refusal is not shown as success: %o", async (body, text) => {
    mswServer.use(http.post(`${API_BASE}/warehouse/exports`, () => HttpResponse.json({ error: body.code, ...body }, { status: body.code.startsWith("row") ? 422 : 403 })));
    render(<ExportPanel snapshot="snap_7" sql="SELECT 1" table="air" />);
    fireEvent.click(screen.getByRole("button", { name: "내보내기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByRole("button", { name: /번들 내려받기/ })).not.toBeInTheDocument();
  });
});
