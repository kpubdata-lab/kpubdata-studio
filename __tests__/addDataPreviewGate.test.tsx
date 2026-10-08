/**
 * Add Data does not build on a failed preview, and comes from the Catalog with the kind
 * of source already chosen (#842). Driven through the page.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddDataPage } from "@/pages/AddDataPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

function RunStub() {
  const { buildId } = useParams();
  return <div>run={buildId}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/add" element={<AddDataPage />} />
        <Route path="/refresh-jobs/:buildId" element={<RunStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

const next = () => fireEvent.click(screen.getByRole("button", { name: "다음" }));

/** A preview answer whose one source is `status`. */
function previewAnswer(status: "ok" | "failed") {
  return {
    dataset_id: "datago-air-quality",
    previews: [
      {
        source_key: "datago.air_quality",
        status,
        error: status === "failed" ? "provider refused: SERVICE_KEY_IS_NOT_REGISTERED" : null,
        schema: status === "failed" ? [] : [{ name: "station", dtype: "Utf8", nullable: false, unique_count: 2 }],
        sample: status === "failed" ? [] : [{ station: "A" }, { station: "B" }],
        total_rows: status === "failed" ? 0 : 2,
        statistics: { row_count: status === "failed" ? 0 : 2, null_counts: {}, duplicate_rate: 0 },
        quality_results: [],
        source_sample: [],
        sample_mode: "first",
        diff_available: false,
        diffs: [],
        transform_summary: null,
        diff_truncated: false,
      },
    ],
  };
}

/** A Builder whose preview is what `answer` says at the time, counting the builds sent to it. */
function builder(answer: () => "ok" | "failed") {
  const builds: string[] = [];
  mswServer.use(
    http.get(`${API_BASE}/providers`, () =>
      HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured: true }] }),
    ),
    // No table of this id yet: the review step's question about one has an answer (#837).
    http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: [] })),
    http.post(`${API_BASE}/preview`, () => HttpResponse.json(previewAnswer(answer()))),
    http.post(`${API_BASE}/builds`, async ({ request }) => {
      const body: unknown = await request.json();
      const runId = typeof body === "object" && body !== null && "run_id" in body ? String(body.run_id) : "run";
      builds.push(runId);
      return HttpResponse.json(
        {
          run_id: runId,
          status: "succeeded",
          created_at: "2026-10-08T02:00:00Z",
          updated_at: "2026-10-08T02:00:01Z",
          response: { status: "ok", run_id: runId, outcomes: [], manifest: `output/${runId}/manifest.json`, api_version: "1.109.0" },
        },
        { status: 202 },
      );
    }),
  );
  return builds;
}

/** Source → Configure for `datago.air_quality`, then the Preview step with a preview run. */
async function reachPreview() {
  renderAt("/add");
  fireEvent.click(screen.getByRole("button", { name: /공공 API/ }));
  next();
  await waitFor(() => expect(document.querySelector('#add-data-provider option[value="datago"]')).not.toBeNull());
  fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
  await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "air_quality" } });
  await screen.findByText(/ID: datago-air-quality/);
  next();
  await screen.findByRole("heading", { name: "Preview · 검증" });
  fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));
}

function buildButton(): HTMLElement {
  return screen.getByRole("button", { name: "테이블 만들기" });
}

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("Add Data — a preview that failed (#842)", () => {
  it("does not build, says why, and builds once the preview has succeeded", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    let previewIs: "ok" | "failed" = "failed";
    const builds = builder(() => previewIs);

    await reachPreview();
    await screen.findByText(/SERVICE_KEY_IS_NOT_REGISTERED/);
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });

    // The spec is valid, and that used to be enough.
    await waitFor(() => expect(document.querySelector('[data-preview-problem="sources_failed"]')).not.toBeNull());
    expect(buildButton()).toBeDisabled();
    expect(document.querySelector("[data-preview-problem]")?.textContent).toContain("SERVICE_KEY_IS_NOT_REGISTERED");
    expect(builds).toEqual([]);

    // The way back, a preview that works, and the build is there.
    fireEvent.click(screen.getByRole("button", { name: "Preview 단계로 돌아가기" }));
    await screen.findByRole("heading", { name: "Preview · 검증" });
    previewIs = "ok";
    fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));
    await waitFor(() => expect(screen.queryByText(/SERVICE_KEY_IS_NOT_REGISTERED/)).toBeNull());
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
    await waitFor(() => expect(buildButton()).toBeEnabled());
    expect(document.querySelector("[data-preview-problem]")).toBeNull();
    fireEvent.click(buildButton());

    await screen.findByText(/^run=/);
    expect(builds).toHaveLength(1);
  });
});

describe("Add Data — coming from the Catalog (#842)", () => {
  it("has the public API chosen and the dataset filled in", async () => {
    renderAt("/add?provider=datago&dataset=apt_trade");

    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).toHaveValue("apt_trade"));
    expect(screen.getByLabelText(/제공자 \(Provider\)/)).toHaveValue("datago");
  });

  it("has the public API chosen even when this catalogue does not list the dataset", async () => {
    // The kind is not asked for again; what is not listed is left to pick, not guessed.
    renderAt("/add?provider=datago&dataset=not-in-this-catalogue");

    await waitFor(() => expect(screen.getByLabelText(/제공자 \(Provider\)/)).toHaveValue("datago"));
    expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).toHaveValue("");
  });

  it("has the public API chosen when the provider is unknown too", async () => {
    renderAt("/add?provider=nobody&dataset=nothing");

    const provider = await screen.findByLabelText(/제공자 \(Provider\)/);
    await waitFor(() => expect(document.querySelector('#add-data-provider option[value="datago"]')).not.toBeNull());
    expect(provider).toHaveValue("");
  });

  it("asks for the kind of source when it comes from nowhere in particular", async () => {
    renderAt("/add");

    expect(screen.getByRole("heading", { name: "데이터 선택" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/제공자 \(Provider\)/)).toBeNull();
  });
});
