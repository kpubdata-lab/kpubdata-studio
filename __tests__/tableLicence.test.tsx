/**
 * Table Detail shows the table's terms of use without an export (#645, builder#764).
 *
 * The terms are the BuildSpec declaration of the run that produced the snapshot on screen:
 * the licence and its kind (SPDX, KOGL under `other`, another licence under `other`), the
 * attribution and the link to the licence's terms. What is not declared is an explicit
 * unknown, and the link is a link only when it is an http(s) URL.
 */
import { act, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { LicenceSummary } from "@/features/licence/LicenceSummary";
import { isSafeLicenceLink, licenceKind, licenceTermsFromSpecYaml, LicenceSpecError, type LicenceTerms } from "@/features/licence/terms";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { hideDemoWarehouse } from "./support/noWarehouse";

const terms = (overrides: Partial<LicenceTerms> = {}): LicenceTerms => ({
  license: null,
  license_name: null,
  license_link: null,
  attribution: null,
  ...overrides,
});

const KOGL_SPEC = [
  "dataset_id: air",
  "title: 대기질",
  "sources:",
  "  - provider: datago",
  "    dataset: air",
  "license: other",
  "license_name: kogl-type-1",
  "license_link: https://www.kogl.or.kr/info/licenseType1.do",
  "attribution: 서울특별시, 서울시 대기환경정보",
  "",
].join("\n");

describe("licence terms from a BuildSpec (#645)", () => {
  it("reads the four fields as declared, and nothing it does not declare", () => {
    expect(licenceTermsFromSpecYaml(KOGL_SPEC)).toEqual({
      license: "other",
      license_name: "kogl-type-1",
      license_link: "https://www.kogl.or.kr/info/licenseType1.do",
      attribution: "서울특별시, 서울시 대기환경정보",
    });
    // Blank, absent or non-text values are not declarations.
    expect(licenceTermsFromSpecYaml("dataset_id: x\nlicense: '  '\nattribution: 3\n")).toEqual(terms());
  });

  it("refuses a spec that is not a mapping instead of reading nothing from it", () => {
    expect(() => licenceTermsFromSpecYaml("- a\n- b\n")).toThrow(LicenceSpecError);
    expect(() => licenceTermsFromSpecYaml("a: [")).toThrow(LicenceSpecError);
  });

  it("tells a KOGL type under `other` apart from an SPDX licence and from another licence", () => {
    expect(licenceKind(terms({ license: "CC-BY-4.0" }))).toBe("spdx");
    expect(licenceKind(terms({ license: "other", license_name: "kogl-type-1" }))).toBe("kogl");
    expect(licenceKind(terms({ license: "KOGL-1" }))).toBe("kogl");
    expect(licenceKind(terms({ license: "other", license_name: "korea-public-data-unrestricted" }))).toBe("other");
    expect(licenceKind(terms({ license: "other" }))).toBe("other");
    expect(licenceKind(terms())).toBe("undeclared");
  });

  it("treats only an absolute http(s) URL as a safe link", () => {
    expect(isSafeLicenceLink("https://www.kogl.or.kr/info/licenseType1.do")).toBe(true);
    expect(isSafeLicenceLink("http://example.org/terms")).toBe(true);
    for (const unsafe of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "/terms", "www.kogl.or.kr", "ftp://example.org/t", "vbscript:x"]) {
      expect(isSafeLicenceLink(unsafe), unsafe).toBe(false);
    }
  });
});

describe("LicenceSummary (#645)", () => {
  it("renders a safe licence link as a link that opens apart from Studio", () => {
    render(<LicenceSummary terms={terms({ license: "other", license_name: "kogl-type-1", license_link: "https://www.kogl.or.kr/info/licenseType1.do", attribution: "서울특별시" })} />);
    const link = screen.getByRole("link", { name: /https:\/\/www\.kogl\.or\.kr\/info\/licenseType1\.do/ });
    expect(link).toHaveAttribute("href", "https://www.kogl.or.kr/info/licenseType1.do");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("never renders a non-http(s) link as a link, but still shows what was declared", () => {
    render(<LicenceSummary terms={terms({ license: "CC-BY-4.0", license_link: "javascript:alert(1)" })} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toHaveAttribute("data-licence-link", "text");
    expect(screen.getByText("http(s) 주소가 아니어서 링크로 열지 않습니다.")).toBeInTheDocument();
  });

  it("marks a KOGL licence differently from an SPDX one", () => {
    const { unmount } = render(<LicenceSummary terms={terms({ license: "other", license_name: "kogl-type-1", attribution: "서울특별시" })} />);
    const kogl = screen.getByText("kogl-type-1").closest("dd")!;
    expect(kogl).toHaveAttribute("data-licence-kind", "kogl");
    expect(within(kogl).getByText("공공누리(KOGL)")).toBeInTheDocument();
    expect(within(kogl).queryByText("SPDX 표준")).not.toBeInTheDocument();
    unmount();

    render(<LicenceSummary terms={terms({ license: "CC-BY-4.0", attribution: "Seoul" })} />);
    const spdx = screen.getByText("CC-BY-4.0").closest("dd")!;
    expect(spdx).toHaveAttribute("data-licence-kind", "spdx");
    expect(within(spdx).getByText("SPDX 표준")).toBeInTheDocument();
    expect(within(spdx).queryByText("공공누리(KOGL)")).not.toBeInTheDocument();
  });

  it("says unknown for every field that is not declared, and asks for KOGL's required attribution", () => {
    const { unmount, container } = render(<LicenceSummary terms={terms()} />);
    expect(screen.getByText("알 수 없음 — BuildSpec 에 선언되지 않음")).toHaveAttribute("data-status", "unknown");
    expect(screen.getByText("알 수 없음 — 선언되지 않음")).toHaveAttribute("data-status", "unknown");
    expect(screen.getByText("알 수 없음 — 원문 링크가 선언되지 않음")).toHaveAttribute("data-status", "unknown");
    expect(container.querySelector("[data-licence-kind]")).toHaveAttribute("data-licence-kind", "undeclared");
    unmount();

    render(<LicenceSummary terms={terms({ license: "other", license_name: "kogl-type-2" })} />);
    expect(screen.getByText("공공누리는 필수지만 선언되지 않음").closest("[data-status]")).toHaveAttribute("data-status", "actionable");
  });
});

describe("Table Detail shows the terms without an export (#645)", () => {
  const specRequests: string[] = [];

  beforeEach(() => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
    specRequests.length = 0;
    const table = { table_id: "t1", logical_name: "air.datago", current_snapshot_id: "snap_2", revision: 2 };
    const snapshot = (snapshot_id: string, run_id: string) => ({
      snapshot_id,
      run_id,
      state: "committed",
      row_count: 10,
      created_at: "2026-09-01T00:00:00Z",
      committed_at: "2026-09-01T00:00:00Z",
      coverage: null,
    });
    mswServer.use(
      http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: [table] })),
      http.get(`${API_BASE}/warehouse/tables/:name`, () => HttpResponse.json({ ...table, snapshots: [snapshot("snap_2", "run-2"), snapshot("snap_1", "run-1")] })),
      http.get(`${API_BASE}/datasets/air`, () =>
        HttpResponse.json({
          dataset_id: "air",
          title: "대기질",
          sources: [{ provider: "data.go.kr", dataset: "air", alias: "air" }],
          latest_run_id: "run-2",
          status: "ok",
          updated_at: "2026-09-02T00:00:00Z",
          row_counts: {},
          total_row_count: 10,
          stages: {},
          quality: null,
          status_axes: { refresh: "succeeded", completeness: "complete", health: "healthy", access: "available", maturity: "beta" },
          run_count: 2,
        }),
      ),
      http.get(`${API_BASE}/builds/:run/spec`, ({ params }) => {
        const run = String(params.run);
        specRequests.push(run);
        if (run === "run-1") return HttpResponse.json({ error: "BuildSpec snapshot unavailable for run: run-1" }, { status: 404 });
        return HttpResponse.json({ run_id: run, spec: KOGL_SPEC, spec_digest: `sha256:${"0".repeat(64)}` });
      }),
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  function renderDetail(entry: string) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/tables/:datasetId" element={<DatasetDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the licence, its KOGL kind, the attribution and the link on Overview, from the snapshot's run", async () => {
    renderDetail("/tables/air");
    const terms = await screen.findByRole("region", { name: "이용 조건" });
    expect(await within(terms).findByText("kogl-type-1")).toBeInTheDocument();
    expect(within(terms).getByText("kogl-type-1").closest("dd")).toHaveAttribute("data-licence-kind", "kogl");
    expect(within(terms).getByText("서울특별시, 서울시 대기환경정보")).toBeInTheDocument();
    expect(within(terms).getByRole("link", { name: /kogl\.or\.kr/ })).toHaveAttribute("href", "https://www.kogl.or.kr/info/licenseType1.do");
    expect(within(terms).getByText("실행 run-2 의 BuildSpec 에 선언된 그대로입니다.")).toBeInTheDocument();
    expect(specRequests).toEqual(["run-2"]);
  });

  it("says the terms are unknown for a past snapshot whose run has no BuildSpec snapshot, instead of borrowing the current run's", async () => {
    renderDetail("/tables/air?snapshot=snap_1");
    const terms = await screen.findByRole("region", { name: "이용 조건" });
    expect(await within(terms).findByText("알 수 없음 — 이 실행에는 BuildSpec 스냅샷이 남아 있지 않습니다.")).toHaveAttribute("data-status", "unknown");
    expect(within(terms).queryByText("kogl-type-1")).not.toBeInTheDocument();
    expect(specRequests).toEqual(["run-1"]);
  });
});

describe("the run-based passport shows the terms too (#645)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    hideDemoWarehouse();
    act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("says unknown in the demo, which has no BuildSpec to read terms from", async () => {
    render(
      <MemoryRouter initialEntries={["/tables/air-quality"]}>
        <Routes>
          <Route path="/tables/:datasetId" element={<DatasetDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const terms = await screen.findByRole("region", { name: "이용 조건" });
    expect(await within(terms).findByText(/알 수 없음 — 데모에는 이용 조건이 없습니다/)).toHaveAttribute("data-status", "unknown");
  });
});
