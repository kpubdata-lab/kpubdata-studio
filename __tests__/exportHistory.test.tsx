/**
 * Past query exports: list, download again, delete (#648, builder#819).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { saveBlobAsFile } from "@/features/artifacts/api";
import { ExportHistory, exportRowState } from "@/features/export/ExportHistory";
import { WarehouseWorkspace } from "@/features/sql/WarehouseWorkspace";
import { API_BASE } from "@/shared/config/env";
import { i18n } from "@/shared/i18n";

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

vi.mock("@/features/artifacts/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/artifacts/api")>()),
  saveBlobAsFile: vi.fn(),
}));

const NOW = Date.parse("2026-09-30T12:00:00Z");
const clock = () => NOW;

function exportOf(id: string, overrides: { status?: string; expires_at?: string; table?: string; download_path?: string | null } = {}) {
  const table = overrides.table ?? "air";
  const expires = overrides.expires_at ?? "2026-10-01T09:00:00Z";
  const downloadPath = overrides.download_path === undefined ? `/warehouse/exports/${id}/download` : overrides.download_path;
  return {
    export_id: id,
    status: overrides.status ?? "completed",
    created_at: "2026-09-30T09:00:00Z",
    expires_at: expires,
    request: { table, snapshot: "current", sql: "SELECT * FROM dataset", format: "csv", profile: "machine", max_rows: 100000 },
    manifest: {
      manifest_version: 1,
      export_id: id,
      created_at: "2026-09-30T09:00:00Z",
      expires_at: expires,
      query: { sql: "SELECT * FROM dataset", user_derived: true },
      snapshot: { table_id: "t", logical_name: table, snapshot_id: "snap_7", revision: 4, run_id: "r1", artifact_digest: "sha256:x", row_count: 3, coverage: null },
      source: {
        dataset_id: "air",
        terms: { status: "declared", license: "KOGL-1", license_name: null, license_link: null, attribution: null },
        provenance: [],
      },
      output: {
        format: "csv",
        profile: "machine",
        encoding: "utf-8",
        bom: false,
        row_count: 3,
        completeness: "full",
        columns: [],
        values_altered: [],
        file: { name: "data.csv", bytes: 10, sha256: "x" },
      },
      pii: { policy: null, allowed_findings: [] },
    },
    bundle: downloadPath ? { filename: `${id}.zip`, media_type: "application/zip", bytes: 99, sha256: "y", files: ["data.csv", "manifest.json", "NOTICE.md"] } : null,
    download_path: downloadPath,
  };
}

function serveList(exports: unknown[]) {
  const calls = { count: 0 };
  mswServer.use(
    http.get(`${API_BASE}/warehouse/exports`, () => {
      calls.count += 1;
      return HttpResponse.json({ exports });
    }),
  );
  return calls;
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-export-id="${id}"]`);

describe("exportRowState (#648)", () => {
  it.each([
    ["completed", "2026-10-01T00:00:00Z", "completed"],
    ["queued", "2026-10-01T00:00:00Z", "pending"],
    ["running", "2026-10-01T00:00:00Z", "pending"],
    ["failed", "2026-10-01T00:00:00Z", "failed"],
    ["cancelled", "2026-10-01T00:00:00Z", "cancelled"],
    ["expired", "2026-10-01T00:00:00Z", "expired"],
    // `expires_at` passed while the list was open: expired whatever the listed status said.
    ["completed", "2026-09-30T11:59:59Z", "expired"],
    ["archived", "2026-10-01T00:00:00Z", "other"],
  ])("%s, expiring %s, reads as %s", (status, expires_at, state) => {
    expect(exportRowState({ status, expires_at }, NOW)).toBe(state);
  });
});

describe("the export list (#648)", () => {
  it("is filled from GET /warehouse/exports and downloads a completed export with Builder's zip", async () => {
    serveList([exportOf("exp_1"), exportOf("exp_2", { table: "weather" })]);
    mswServer.use(
      http.get(`${API_BASE}/warehouse/exports/exp_1/download`, () =>
        new HttpResponse("PK", { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="exp_1.zip"' } }),
      ),
    );
    render(<ExportHistory now={clock} />);
    await waitFor(() => expect(row("exp_1")).not.toBeNull());
    expect(row("exp_2")).not.toBeNull();
    const first = within(row("exp_1")!);
    expect(first.getByText("air@snap_7 · rev 4 을 읽었습니다")).toBeInTheDocument();
    expect(first.getByText(/csv · 3행/)).toBeInTheDocument();
    expect(first.getByText("준비됨")).toHaveAttribute("data-status", "normal");
    fireEvent.click(first.getByRole("button", { name: /번들 내려받기/ }));
    await waitFor(() => expect(vi.mocked(saveBlobAsFile).mock.calls.map((call) => call[1])).toContain("exp_1.zip"));
  });

  it("says there is nothing when Builder keeps no unexpired export", async () => {
    serveList([]);
    render(<ExportHistory now={clock} />);
    expect(await screen.findByText("만료되지 않은 내보내기가 없습니다.")).toBeInTheDocument();
  });

  it("tells expired, failed and cancelled apart and disables their download", async () => {
    serveList([
      exportOf("exp_expired", { status: "expired", download_path: null }),
      exportOf("exp_lapsed", { expires_at: "2026-09-30T11:00:00Z" }),
      exportOf("exp_failed", { status: "failed", download_path: null }),
      exportOf("exp_cancelled", { status: "cancelled", download_path: null }),
    ]);
    render(<ExportHistory now={clock} />);
    await waitFor(() => expect(row("exp_expired")).not.toBeNull());
    const expected: Array<[string, string, RegExp]> = [
      ["exp_expired", "만료됨", /Builder 가 파일을 삭제해/],
      ["exp_lapsed", "만료됨", /Builder 가 파일을 삭제해/],
      ["exp_failed", "실패", /끝내지 못해 파일이 없습니다/],
      ["exp_cancelled", "취소됨", /중단된 내보내기라/],
    ];
    for (const [id, word, reason] of expected) {
      const scope = within(row(id)!);
      expect(scope.getByText(word).closest("[data-status]")).toHaveAttribute("data-status", "actionable");
      expect(scope.getByText(reason)).toBeInTheDocument();
      expect(scope.getByRole("button", { name: /번들 내려받기/ })).toBeDisabled();
    }
    expect(within(row("exp_failed")!).getByText("실패").closest("[data-tone]")).toHaveAttribute("data-tone", "failure");
  });

  it("marks an export expired when Builder answers its download with 410", async () => {
    serveList([exportOf("exp_1")]);
    mswServer.use(
      http.get(`${API_BASE}/warehouse/exports/exp_1/download`, () =>
        HttpResponse.json({ code: "export_expired", error: "export_expired", message: "expired" }, { status: 410 }),
      ),
    );
    render(<ExportHistory now={clock} />);
    await waitFor(() => expect(row("exp_1")).not.toBeNull());
    fireEvent.click(within(row("exp_1")!).getByRole("button", { name: /번들 내려받기/ }));
    await waitFor(() => expect(row("exp_1")).toHaveAttribute("data-state", "expired"));
    expect(within(row("exp_1")!).getByRole("button", { name: /번들 내려받기/ })).toBeDisabled();
  });

  it("explains a download the source's terms hold back (403 redistribution_forbidden)", async () => {
    serveList([exportOf("exp_1")]);
    mswServer.use(
      http.get(`${API_BASE}/warehouse/exports/exp_1/download`, () =>
        HttpResponse.json(
          {
            code: "redistribution_forbidden",
            error: "redistribution_forbidden",
            message: "forbidden",
            redistribution: { verdict: "forbidden", sources: [{ source: "datago__air", verdict: "forbidden" }] },
          },
          { status: 403 },
        ),
      ),
    );
    render(<ExportHistory now={clock} />);
    await waitFor(() => expect(row("exp_1")).not.toBeNull());
    fireEvent.click(within(row("exp_1")!).getByRole("button", { name: /번들 내려받기/ }));
    // The same sentence the export panel shows for this refusal (#640), not a second wording.
    expect(await within(row("exp_1")!).findByRole("alert")).toHaveTextContent(i18n.t("export.refused.redistribution"));
  });
});

describe("deleting an export (#648)", () => {
  it("asks first, and does nothing when the person says no", async () => {
    serveList([exportOf("exp_1")]);
    const deletes: string[] = [];
    mswServer.use(
      http.delete(`${API_BASE}/warehouse/exports/:id`, ({ params }) => {
        deletes.push(String(params.id));
        return HttpResponse.json({ export_id: params.id, deleted: true });
      }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ExportHistory now={clock} />);
    await waitFor(() => expect(row("exp_1")).not.toBeNull());
    fireEvent.click(within(row("exp_1")!).getByRole("button", { name: "삭제" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("air 내보내기(exp_1)"));
    expect(deletes).toEqual([]);
    expect(row("exp_1")).not.toBeNull();
  });

  it("calls DELETE /warehouse/exports/{export_id} and removes the row", async () => {
    serveList([exportOf("exp_1"), exportOf("exp_2")]);
    const deletes: string[] = [];
    mswServer.use(
      http.delete(`${API_BASE}/warehouse/exports/:id`, ({ params }) => {
        deletes.push(String(params.id));
        return HttpResponse.json({ export_id: params.id, deleted: true });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExportHistory now={clock} />);
    await waitFor(() => expect(row("exp_1")).not.toBeNull());
    fireEvent.click(within(row("exp_1")!).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(row("exp_1")).toBeNull());
    expect(deletes).toEqual(["exp_1"]);
    expect(row("exp_2")).not.toBeNull();
  });

  it("treats an export already gone (404 export_not_found) as deleted", async () => {
    serveList([exportOf("exp_1")]);
    mswServer.use(
      http.delete(`${API_BASE}/warehouse/exports/:id`, () =>
        HttpResponse.json({ code: "export_not_found", error: "export_not_found", message: "no such export" }, { status: 404 }),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExportHistory now={clock} />);
    await waitFor(() => expect(row("exp_1")).not.toBeNull());
    fireEvent.click(within(row("exp_1")!).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(row("exp_1")).toBeNull());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the row and says so when the delete fails", async () => {
    serveList([exportOf("exp_1")]);
    mswServer.use(
      http.delete(`${API_BASE}/warehouse/exports/:id`, () => HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 })),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExportHistory now={clock} />);
    await waitFor(() => expect(row("exp_1")).not.toBeNull());
    fireEvent.click(within(row("exp_1")!).getByRole("button", { name: "삭제" }));
    expect(await within(row("exp_1")!).findByRole("alert")).toHaveTextContent("내보내기를 삭제하지 못했습니다");
    expect(row("exp_1")).not.toBeNull();
  });
});

describe("a new export refreshes the list (#648)", () => {
  it("reloads GET /warehouse/exports once the export panel's export is kept", async () => {
    const tables = [{ table_id: "t1", logical_name: "air", current_snapshot_id: "snap_7", revision: 4 }];
    let kept = false;
    const calls = { count: 0 };
    mswServer.use(
      http.get(`${API_BASE}/warehouse/tables/:name`, () =>
        HttpResponse.json({
          ...tables[0],
          snapshots: [{ snapshot_id: "snap_7", run_id: "r", state: "committed", row_count: 2, created_at: "x", committed_at: "x", coverage: null }],
        }),
      ),
      http.post(`${API_BASE}/warehouse/rows`, () => HttpResponse.json({ code: "x", message: "not under test" }, { status: 500 })),
      http.post(`${API_BASE}/warehouse/aggregate`, () => HttpResponse.json({ code: "x", message: "not under test" }, { status: 500 })),
      http.get(`${API_BASE}/warehouse/exports`, () => {
        calls.count += 1;
        return HttpResponse.json({ exports: kept ? [exportOf("exp_new")] : [] });
      }),
      http.post(`${API_BASE}/warehouse/exports`, () => {
        kept = true;
        return HttpResponse.json(exportOf("exp_new"));
      }),
    );
    render(
      <MemoryRouter initialEntries={["/sql?table=air"]}>
        <WarehouseWorkspace tables={tables} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("만료되지 않은 내보내기가 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "내보내기" }));
    await waitFor(() => expect(row("exp_new")).not.toBeNull());
    expect(calls.count).toBe(2);
  });
});
