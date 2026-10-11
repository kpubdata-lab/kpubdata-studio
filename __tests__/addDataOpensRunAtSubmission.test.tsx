/**
 * Create Table shows the run as soon as Builder has accepted it (#842).
 *
 * The wizard waited on its last step until the run ended. A run that sat in the queue kept
 * it on "running", and a user who left stopped the polling without being told the run
 * went on. The run has a page of its own that shows it waiting, follows it and offers its
 * cancel — so the wizard goes there once there is a run id to go to.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasAddDataDraft } from "@/features/add-data/draftStorage";
import { hasBuildSpec } from "@/features/build-spec/specStore";
import { AddDataPage } from "@/pages/AddDataPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

function RunStub() {
  const { buildId } = useParams();
  return <div>run={buildId}</div>;
}

/** A Builder that answers a submission with `submission`, and whose job never leaves `queued`. */
function builder(submission: "accepts" | "refuses") {
  const state = { submitted: [] as string[], polls: 0 };
  mswServer.use(
    http.get(`${API_BASE}/providers`, () =>
      HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured: true }] }),
    ),
    http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: [] })),
    http.post(`${API_BASE}/builds`, async ({ request }) => {
      if (submission === "refuses") return HttpResponse.json({ error: "invalid spec: nothing to build" }, { status: 400 });
      const body: unknown = await request.json();
      const runId = typeof body === "object" && body !== null && "run_id" in body ? String(body.run_id) : "run";
      state.submitted.push(runId);
      return HttpResponse.json(
        { run_id: runId, status: "queued", created_at: "2026-10-09T02:00:00Z", updated_at: "2026-10-09T02:00:00Z" },
        { status: 202 },
      );
    }),
    http.get(`${API_BASE}/builds/:runId`, ({ params }) => {
      state.polls += 1;
      return HttpResponse.json({
        run_id: String(params.runId),
        status: "queued",
        created_at: "2026-10-09T02:00:00Z",
        updated_at: "2026-10-09T02:00:00Z",
      });
    }),
  );
  return state;
}

/** Through the wizard to the review step, with a preview run. */
async function reachReview() {
  render(
    <MemoryRouter initialEntries={["/add"]}>
      <Routes>
        <Route path="/add" element={<AddDataPage />} />
        <Route path="/refresh-jobs/:buildId" element={<RunStub />} />
      </Routes>
    </MemoryRouter>,
  );
  const next = () => fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: /공공 API/ }));
  next();
  await waitFor(() => expect(document.querySelector('#add-data-provider option[value="datago"]')).not.toBeNull());
  fireEvent.change(screen.getByLabelText(/^제공자/), { target: { value: "datago" } });
  await waitFor(() => expect(screen.getByLabelText(/^소스 데이터셋/)).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText(/^소스 데이터셋/), { target: { value: "air_quality" } });
  await screen.findByText(/ID: datago-air-quality/);
  next();
  await screen.findByRole("heading", { name: "미리보기 · 검증" });
  fireEvent.click(screen.getByRole("button", { name: "미리보기 새로고침" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
  next();
  await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
  await waitFor(() => expect(screen.getByRole("button", { name: "테이블 만들기" })).toBeEnabled());
}

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("Create Table, once Builder has accepted the job (#842)", () => {
  it("opens the run's page while the run is still queued", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const state = builder("accepts");
    await reachReview();
    // What "save draft" leaves behind, and a finished table should not.
    fireEvent.click(screen.getByRole("button", { name: /초안 저장|임시 저장/ }));
    expect(hasAddDataDraft()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "테이블 만들기" }));

    // The job never leaves the queue in this test: waiting for its end would wait for ever.
    const [runId] = await waitFor(() => {
      expect(state.submitted).toHaveLength(1);
      return state.submitted;
    });
    expect(await screen.findByText(`run=${runId}`)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "검토 · 테이블 만들기" })).not.toBeInTheDocument();
    // Nothing of the wizard is left to come back to, and the spec is where the run's
    // page and its edit page look for it.
    expect(hasAddDataDraft()).toBe(false);
    expect(hasBuildSpec(runId)).toBe(true);
  });

  it("stays on the review step when Builder refuses the submission", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const state = builder("refuses");
    await reachReview();

    fireEvent.click(screen.getByRole("button", { name: "테이블 만들기" }));

    expect(await screen.findByText(/invalid spec: nothing to build/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "검토 · 테이블 만들기" })).toBeInTheDocument();
    expect(screen.queryByText(/^run=/)).not.toBeInTheDocument();
    expect(state.submitted).toEqual([]);
  });
});
