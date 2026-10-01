/**
 * The column profile of the snapshot on screen (#647, builder#817, #896, #897).
 *
 * The profile is asked for the concrete snapshot being viewed and refused when Builder
 * answers for another one. Statistics are the contract's fields as sent; a withheld column
 * shows its name, types and sensitivity only; and 504, 429, 409, 403 and 503 each say what
 * happened and what to do next.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { PROFILE_TIMEOUT_MEMORY_MS, profileRefusal } from "@/features/datasets/profileRefusal";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { ApiError } from "@/shared/lib/builderApi";
import { snapshotProfileResponseSchema } from "@/shared/lib/builderApi.schema";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderDetail(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/tables/:datasetId" element={<DatasetDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const TABLE = { table_id: "t1", logical_name: "air.datago", current_snapshot_id: "snap_2", revision: 2 };
const snapshot = (snapshot_id: string, run_id: string) => ({
  snapshot_id,
  run_id,
  state: "committed",
  row_count: 1000,
  created_at: "2026-09-01T00:00:00Z",
  committed_at: "2026-09-01T00:00:00Z",
  coverage: null,
});

const PHONE_SENTINEL = "010-1234-5678";

function profileBody(snapshotId: string) {
  return {
    snapshot: { table_id: "t1", logical_name: "air.datago", snapshot_id: snapshotId, revision: 2 },
    profile: {
      snapshot_id: snapshotId,
      artifact_digest: "sha256:abc",
      algorithm_version: 2,
      computed_at: "2026-09-01T00:00:00Z",
      scope: { mode: "full", sampled: false, sample_size: null },
      accuracy: "exact",
      min_range_values: 10,
      row_count: 1000,
      columns: [
        {
          name: "pm10",
          storage_type: "Float64",
          logical_type: "float64",
          time_zone: null,
          sensitivity: { status: "not_detected", kinds: [] },
          status: "profiled",
          null_count: 25,
          null_ratio: 0.025,
          nan_count: 3,
          infinite_count: 1,
          range: { status: "exact", min: 0.5, max: 412.25, wire_encoding: "number", value_count: 971, excluded_count: 4 },
        },
        {
          name: "station_code",
          storage_type: "String",
          logical_type: "identifier",
          time_zone: null,
          sensitivity: { status: "not_detected", kinds: [] },
          status: "profiled",
          null_count: 0,
          null_ratio: 0,
          nan_count: null,
          infinite_count: null,
          range: { status: "not_applicable" },
        },
        {
          name: "rare_value",
          storage_type: "Int64",
          logical_type: "int64",
          time_zone: null,
          sensitivity: { status: "not_detected", kinds: [] },
          status: "profiled",
          null_count: 994,
          null_ratio: 0.994,
          nan_count: null,
          infinite_count: null,
          range: { status: "withheld_small_group", value_count: 6 },
        },
        {
          name: "contact",
          storage_type: "String",
          logical_type: "string",
          time_zone: null,
          sensitivity: { status: "suspected", kinds: ["phone"] },
          status: "withheld",
          null_count: null,
          null_ratio: null,
          nan_count: null,
          infinite_count: null,
          range: null,
        },
        {
          name: "payload",
          storage_type: "Struct",
          logical_type: "json",
          time_zone: null,
          sensitivity: { status: "suspected", kinds: ["unchecked_values"] },
          status: "withheld",
          null_count: null,
          null_ratio: null,
          nan_count: null,
          infinite_count: null,
          range: null,
        },
      ],
    },
  };
}

let profileRequests: string[];
let answer: (snapshotId: string) => Response;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
  profileRequests = [];
  answer = (snapshotId) => HttpResponse.json(profileBody(snapshotId));
  mswServer.use(
    http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: [TABLE] })),
    http.get(`${API_BASE}/warehouse/tables/:name/profile`, ({ request }) => {
      const requested = new URL(request.url).searchParams.get("snapshot") ?? "";
      profileRequests.push(requested);
      return answer(requested);
    }),
    http.get(`${API_BASE}/warehouse/tables/:name`, () => HttpResponse.json({ ...TABLE, snapshots: [snapshot("snap_2", "run-2"), snapshot("snap_1", "run-1")] })),
    http.get(`${API_BASE}/datasets/air`, () =>
      HttpResponse.json({
        dataset_id: "air",
        title: "대기질",
        sources: [{ provider: "data.go.kr", dataset: "air", alias: "air" }],
        latest_run_id: "run-2",
        status: "ok",
        updated_at: "2026-09-02T00:00:00Z",
        row_counts: {},
        total_row_count: 1000,
        stages: {},
        quality: null,
        status_axes: { refresh: "succeeded", completeness: "complete", health: "healthy", access: "available", maturity: "beta" },
        run_count: 2,
      }),
    ),
    http.get(`${API_BASE}/builds/:run/spec`, () => HttpResponse.json({ error: "none" }, { status: 404 })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const location = () => screen.getByTestId("location").textContent ?? "";
const refusal = (status: number, body: Record<string, unknown>) => () => HttpResponse.json(body, { status });

describe("the column profile tab (#647)", () => {
  it("is reached from Overview and asks for the concrete current snapshot, never `current`", async () => {
    renderDetail("/tables/air");
    fireEvent.click(await screen.findByRole("button", { name: "컬럼 프로파일 보기" }));
    expect(location()).toBe("/tables/air?tab=profile");
    const panel = await screen.findByRole("tabpanel", { name: "프로파일" });
    await within(panel).findByText("pm10");
    expect(profileRequests).toEqual(["snap_2"]);
  });

  it("pins a past snapshot being viewed", async () => {
    renderDetail("/tables/air?snapshot=snap_1&tab=profile");
    const panel = await screen.findByRole("tabpanel", { name: "프로파일" });
    await within(panel).findByText("pm10");
    expect(profileRequests).toEqual(["snap_1"]);
    expect(panel).toHaveTextContent("snap_1");
  });

  it("refuses a profile Builder sent for another snapshot", async () => {
    answer = () => HttpResponse.json(profileBody("snap_9"));
    renderDetail("/tables/air?tab=profile");
    const panel = await screen.findByRole("tabpanel", { name: "프로파일" });
    expect(await within(panel).findByText(/요청한 스냅샷 snap_2 이 아닌 snap_9 의 프로파일/)).toBeInTheDocument();
    expect(within(panel).queryByText("pm10")).not.toBeInTheDocument();
  });

  it("shows null, NaN and infinite counts and ranges as sent, and a small-group range as withheld", async () => {
    renderDetail("/tables/air?tab=profile");
    const panel = await screen.findByRole("tabpanel", { name: "프로파일" });
    const pm10 = (await within(panel).findByText("pm10")).closest("tr")!;
    const cells = within(pm10).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("float64저장 Float64");
    expect(cells[2]).toHaveTextContent("25(2.5%)");
    expect(within(cells[2]).getByText(/2\.5%/)).toHaveAttribute("title", "0.025");
    expect(cells[3]).toHaveTextContent("3");
    expect(cells[4]).toHaveTextContent("1");
    expect(cells[5]).toHaveTextContent("0.5 … 412.25");
    expect(cells[5]).toHaveTextContent("NaN·무한값 4개 제외");

    const station = within(panel).getByText("station_code").closest("tr")!;
    expect(station).toHaveTextContent("identifier");
    // NaN, infinite and range do not apply to a text column: N/A, not 0 and not a blank.
    expect(station.querySelectorAll('[data-status="not-evaluated"]')).toHaveLength(3);
    expect(station).toHaveTextContent("0(0%)");

    const rare = within(panel).getByText("rare_value").closest("tr")!;
    expect(rare).toHaveTextContent("표본 부족으로 보류");
    expect(rare).toHaveTextContent("값 6개 < 10개");
    expect(panel).toHaveTextContent("값이 10개 미만이면 범위는 보류됩니다");
  });

  it("shows a withheld column's name, types and sensitivity only, and says why its statistics are withheld", async () => {
    renderDetail("/tables/air?tab=profile");
    const panel = await screen.findByRole("tabpanel", { name: "프로파일" });
    const contact = (await within(panel).findByText("contact")).closest("tr")!;
    expect(contact).toHaveAttribute("data-column-status", "withheld");
    expect(within(contact).getByText("개인정보 의심").closest("[data-status]")).toHaveAttribute("data-status", "actionable");
    expect(contact).toHaveTextContent("phone");
    expect(contact).toHaveTextContent("개인정보 의심으로 통계를 보류했습니다 — 값은 보여 주지 않습니다.");
    // No statistic cell, and nothing that looks like a count.
    expect(within(contact).getAllByRole("cell")).toHaveLength(3);
    expect(contact.textContent).not.toMatch(/\d/);
    expect(panel).not.toHaveTextContent(PHONE_SENTINEL);

    const payload = within(panel).getByText("payload").closest("tr")!;
    expect(payload).toHaveTextContent("값 미검사(텍스트를 담을 수 있는 타입)");
    expect(panel).toHaveTextContent("컬럼 2개는 개인정보로 의심되어");
  });
});

describe("profile refusals, each with its next step (#647)", () => {
  it("504 query_timeout: says Builder remembers it for 5 minutes, holds the retry until then, and offers SQL", async () => {
    answer = refusal(504, { error: "profiling timed out", code: "query_timeout" });
    renderDetail("/tables/air?tab=profile");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-refusal", "query_timeout");
    expect(alert).toHaveTextContent("프로파일 계산 시간이 초과되었습니다");
    expect(alert).toHaveTextContent("5분 동안 기억해");
    expect(within(alert).getByRole("button", { name: /이후 다시 시도/ })).toBeDisabled();
    expect(within(alert).getByRole("link", { name: "SQL 로 집계하기" })).toHaveAttribute("href", "/sql?table=air.datago");
    expect(profileRequests).toEqual(["snap_2"]);
  });

  it("504 query_timeout: re-enables the retry once the 5 minutes have passed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer = refusal(504, { error: "profiling timed out", code: "query_timeout" });
    renderDetail("/tables/air?tab=profile");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: /이후 다시 시도/ })).toBeDisabled();
    // Two steps: the first lets the release timer be set, the second lets it fire.
    await act(async () => {
      vi.advanceTimersByTime(PROFILE_TIMEOUT_MEMORY_MS + 1000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    answer = (snapshotId) => HttpResponse.json(profileBody(snapshotId));
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" }));
    vi.useRealTimers();
    await screen.findByText("pm10");
    expect(profileRequests).toEqual(["snap_2", "snap_2"]);
  });

  it("429 query_busy: says capacity is taken and retries on request", async () => {
    answer = refusal(429, { error: "busy", code: "query_busy" });
    renderDetail("/tables/air?tab=profile");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-refusal", "query_busy");
    expect(alert).toHaveTextContent("쿼리 자리가 모두 사용 중입니다");
    answer = (snapshotId) => HttpResponse.json(profileBody(snapshotId));
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    await screen.findByText("pm10");
    expect(profileRequests).toEqual(["snap_2", "snap_2"]);
  });

  it("409 snapshot_unavailable: offers the Snapshots tab", async () => {
    answer = refusal(409, { error: "unreadable", code: "snapshot_unavailable" });
    renderDetail("/tables/air?tab=profile");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("이 스냅샷을 읽을 수 없습니다");
    fireEvent.click(within(alert).getByRole("button", { name: "스냅샷 탭 열기" }));
    expect(location()).toBe("/tables/air?tab=snapshots");
  });

  it("403 redistribution_forbidden: names the forbidding source and sends to the terms on Overview", async () => {
    answer = refusal(403, {
      error: "forbidden",
      code: "redistribution_forbidden",
      redistribution: { verdict: "forbidden", sources: [{ source: "datago", verdict: "forbidden" }, { source: "kma", verdict: "allowed" }] },
    });
    renderDetail("/tables/air?tab=profile");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("원천 이용 조건이 재배포를 금지합니다");
    expect(alert).toHaveTextContent("금지한 원천: datago");
    expect(alert).not.toHaveTextContent("kma");
    expect(within(alert).queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "개요에서 이용 조건 보기" }));
    expect(location()).toBe("/tables/air");
  });

  it("503 pii_declaration_unavailable: says Builder failed closed and names the source", async () => {
    answer = refusal(503, { error: "unavailable", code: "pii_declaration_unavailable", dataset: "datago.air" });
    renderDetail("/tables/air?tab=profile");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-refusal", "pii_declaration_unavailable");
    expect(alert).toHaveTextContent("원천의 개인정보 선언을 읽지 못했습니다");
    expect(alert).toHaveTextContent("원천: datago.air");
    expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeEnabled();
  });

  it("anything else is a plain error with a retry", async () => {
    answer = refusal(400, { error: "profiling failed" });
    renderDetail("/tables/air?tab=profile");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("컬럼 프로파일을 불러오지 못했습니다");
    expect(alert).toHaveTextContent("profiling failed");
    await waitFor(() => expect(profileRequests).toEqual(["snap_2"]));
  });
});

describe("profileRefusal (#647)", () => {
  it("reads each refusal by status and code, and nothing else", () => {
    expect(profileRefusal(new ApiError(504, "x", { code: "query_timeout" }))).toEqual({ code: "query_timeout" });
    expect(profileRefusal(new ApiError(429, "x", { code: "query_busy" }))).toEqual({ code: "query_busy" });
    expect(profileRefusal(new ApiError(409, "x", { code: "snapshot_unavailable" }))).toEqual({ code: "snapshot_unavailable" });
    expect(profileRefusal(new ApiError(403, "x", { code: "redistribution_forbidden" }))).toEqual({ code: "redistribution_forbidden", sources: [] });
    expect(profileRefusal(new ApiError(503, "x", { code: "pii_declaration_unavailable" }))).toEqual({ code: "pii_declaration_unavailable", dataset: null });
    expect(profileRefusal(new ApiError(403, "x", { code: "forbidden" }))).toBeNull();
    expect(profileRefusal(new ApiError(404, "x", { code: "table_not_found" }))).toBeNull();
    expect(profileRefusal(new Error("x"))).toBeNull();
  });

  it("parses the contract's profile response, a withheld column included", () => {
    expect(snapshotProfileResponseSchema.safeParse(profileBody("snap_2")).success).toBe(true);
  });
});
