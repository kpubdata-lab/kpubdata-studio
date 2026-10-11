/**
 * Adding a dataset that already has a table does not replace it unasked (#837).
 *
 * A dataset id made from the provider and dataset name is the same whatever conditions
 * were asked for, so a second add of the same dataset — another station — committed a new
 * revision of the same table, with no warning. Driven through the page against a Builder
 * (MSW): what matters is the spec `POST /builds` receives.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** The source key the preview answers with (`__tests__/msw/handlers.ts`): it names the table. */
const SOURCE_KEY = "kma__forecast";

/** A table of `datasetId`: by default the one a build of the previewed source would commit to. */
function existingTable(datasetId: string, rows: number, sourceKey = SOURCE_KEY, owner: string | null = datasetId) {
  return {
    table_id: `tbl_${datasetId}_${sourceKey}`,
    logical_name: `${datasetId}.${sourceKey}`,
    current_snapshot_id: "snap_1",
    revision: 1,
    current_snapshot: { snapshot_id: "snap_1", row_count: rows, committed_at: "2026-10-08T01:00:00Z", coverage: null },
    dataset_id: owner,
  };
}

/** A Builder with `tables`, that records the dataset id of every spec submitted to it. */
function builderWith(tables: () => Response): { submitted: string[]; ifAbsent: boolean[]; listed: () => number } {
  const submitted: string[] = [];
  // Whether each submission asked for new tables only (#881, builder#1223).
  const ifAbsent: boolean[] = [];
  let listed = 0;
  mswServer.use(
    http.get(`${API_BASE}/providers`, () =>
      HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured: true }] }),
    ),
    http.get(`${API_BASE}/warehouse/tables`, () => {
      listed += 1;
      return tables();
    }),
    http.post(`${API_BASE}/builds`, async ({ request }) => {
      const body: unknown = await request.json();
      const spec: unknown =
        typeof body === "object" && body !== null && "spec" in body && typeof body.spec === "string" ? JSON.parse(body.spec) : null;
      const datasetId =
        typeof spec === "object" && spec !== null && "dataset_id" in spec ? String(spec.dataset_id) : "(none)";
      submitted.push(datasetId);
      ifAbsent.push(typeof body === "object" && body !== null && "if_absent" in body && body.if_absent === true);
      const runId = `run-of-${datasetId}`;
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
  return { submitted, ifAbsent, listed: () => listed };
}

/** Source → Configure → Preview → the review step, for `datago.air_quality`. */
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
  await screen.findByText("API 사용 준비");
  // The catalogue has arrived: until then the provider cannot be chosen.
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
}

function buildButton(): HTMLElement {
  return screen.getByRole("button", { name: "테이블 만들기" });
}

function shownSpec(): { dataset_id?: unknown; title?: unknown } {
  const shown: unknown = JSON.parse(document.querySelector("pre")?.textContent ?? "null");
  return typeof shown === "object" && shown !== null ? shown : {};
}

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("Create Table — a table of this id is already there (#837)", () => {
  it("builds a new table under a free id unless told otherwise, and leaves the old one", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const builder = builderWith(() => HttpResponse.json({ tables: [existingTable("datago-air-quality", 22)] }));

    await reachReview();

    const notice = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-existing-table="found"]');
      expect(found).not.toBeNull();
      return found!;
    });
    // It names the table that is there, and how much is in it.
    expect(within(notice).getByText(`datago-air-quality.${SOURCE_KEY}`)).toBeInTheDocument();
    expect(within(notice).getByText(/22행/)).toBeInTheDocument();
    expect(within(notice).getByRole("radio", { name: /새 테이블로 만들기/ })).toBeChecked();
    expect(within(notice).getByRole("radio", { name: /기존 테이블 갱신/ })).not.toBeChecked();
    // What is shown is what is submitted: the new id, in the spec and in the table's name.
    expect(shownSpec().dataset_id).toBe("datago-air-quality-2");

    await waitFor(() => expect(buildButton()).toBeEnabled());
    fireEvent.click(buildButton());

    await screen.findByText("run=run-of-datago-air-quality-2");
    expect(builder.submitted).toEqual(["datago-air-quality-2"]);
    // A new table asks Builder to refuse one that is there by the commit (#881).
    expect(builder.ifAbsent).toEqual([true]);
  });

  it("refreshes the existing table only when the user chooses to", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const builder = builderWith(() => HttpResponse.json({ tables: [existingTable("datago-air-quality", 22)] }));

    await reachReview();
    fireEvent.click(await screen.findByRole("radio", { name: /기존 테이블 갱신/ }));

    expect(shownSpec().dataset_id).toBe("datago-air-quality");
    await waitFor(() => expect(buildButton()).toBeEnabled());
    fireEvent.click(buildButton());

    await screen.findByText("run=run-of-datago-air-quality");
    expect(builder.submitted).toEqual(["datago-air-quality"]);
    // A refresh replaces the table on purpose.
    expect(builder.ifAbsent).toEqual([false]);
  });

  it("skips the ids that are taken too", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const builder = builderWith(() =>
      HttpResponse.json({ tables: [existingTable("datago-air-quality", 22), existingTable("datago-air-quality-2", 0)] }),
    );

    await reachReview();
    await screen.findByRole("radio", { name: /새 테이블로 만들기/ });
    await waitFor(() => expect(buildButton()).toBeEnabled());
    fireEvent.click(buildButton());

    await screen.findByText("run=run-of-datago-air-quality-3");
    expect(builder.submitted).toEqual(["datago-air-quality-3"]);
  });

  it("does not overwrite a table Builder could not attribute to a dataset", async () => {
    // `dataset_id: null`: Builder could not read the spec of the run behind the table.
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const builder = builderWith(() => HttpResponse.json({ tables: [existingTable("datago-air-quality", 22, SOURCE_KEY, null)] }));

    await reachReview();
    await screen.findByRole("radio", { name: /기존 테이블 갱신/ });
    await waitFor(() => expect(buildButton()).toBeEnabled());
    fireEvent.click(buildButton());

    await screen.findByText("run=run-of-datago-air-quality-2");
    expect(builder.submitted).toEqual(["datago-air-quality-2"]);
  });

  it("says a table would be added beside, not replaced, when only the id is shared", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const builder = builderWith(() => HttpResponse.json({ tables: [existingTable("datago-air-quality", 22, "another_source")] }));

    await reachReview();

    const notice = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-existing-table="found"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(notice.getAttribute("data-existing-table-replaces")).toBe("false");
    expect(within(notice).queryByRole("radio", { name: /기존 테이블 갱신/ })).toBeNull();
    // A new id is still the default; the same id is there to choose.
    fireEvent.click(within(notice).getByRole("radio", { name: /같은 ID 아래에 추가/ }));
    await waitFor(() => expect(buildButton()).toBeEnabled());
    fireEvent.click(buildButton());
    await screen.findByText("run=run-of-datago-air-quality");
    expect(builder.submitted).toEqual(["datago-air-quality"]);
  });

  it("shows the id and the numbered title the new table is built under", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    builderWith(() => HttpResponse.json({ tables: [existingTable("datago-air-quality", 22)] }));

    await reachReview();
    await screen.findByRole("radio", { name: /새 테이블로 만들기/ });

    expect(shownSpec()).toMatchObject({ dataset_id: "datago-air-quality-2", title: "대기오염 (2)" });
    expect(screen.getByText("ID: datago-air-quality-2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /기존 테이블 갱신/ }));
    expect(shownSpec()).toMatchObject({ dataset_id: "datago-air-quality", title: "대기오염" });
    expect(screen.getByText("ID: datago-air-quality")).toBeInTheDocument();
  });

  it("says nothing and keeps the id when no table of it is there", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const builder = builderWith(() => HttpResponse.json({ tables: [existingTable("something-else", 5)] }));

    await reachReview();
    await waitFor(() => expect(buildButton()).toBeEnabled());

    expect(document.querySelector("[data-existing-table]")).toBeNull();
    fireEvent.click(buildButton());
    await screen.findByText("run=run-of-datago-air-quality");
    expect(builder.submitted).toEqual(["datago-air-quality"]);
  });

  it("holds the build while it cannot tell, and builds once it can", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    let reachable = false;
    const builder = builderWith(() =>
      reachable
        ? HttpResponse.json({ tables: [existingTable("datago-air-quality", 22)] })
        : HttpResponse.json({ error: "forbidden" }, { status: 403 }),
    );

    await reachReview();

    await waitFor(() => expect(document.querySelector('[data-existing-table="unknown"]')).not.toBeNull());
    expect(buildButton()).toBeDisabled();
    expect(builder.submitted).toEqual([]);

    reachable = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));

    await screen.findByRole("radio", { name: /새 테이블로 만들기/ });
    await waitFor(() => expect(buildButton()).toBeEnabled());
    fireEvent.click(buildButton());
    await screen.findByText("run=run-of-datago-air-quality-2");
    expect(builder.submitted).toEqual(["datago-air-quality-2"]);
  });

  it("asks again when the review step is entered again", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const builder = builderWith(() => HttpResponse.json({ tables: [existingTable("datago-air-quality", 22)] }));

    await reachReview();
    fireEvent.click(await screen.findByRole("radio", { name: /기존 테이블 갱신/ }));
    const asked = builder.listed();
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await screen.findByRole("heading", { name: "미리보기 · 검증" });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });

    // A choice to replace a table does not outlive the look that led to it.
    expect(await screen.findByRole("radio", { name: /새 테이블로 만들기/ })).toBeChecked();
    expect(builder.listed()).toBeGreaterThan(asked);
  });

  it("does not overwrite a table another tab made after the review step asked (#861)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    // Another tab builds datago-air-quality-2 while this one is on the review step.
    let tables = [existingTable("datago-air-quality", 22)];
    const builder = builderWith(() => HttpResponse.json({ tables }));

    await reachReview();
    await waitFor(() => expect(shownSpec().dataset_id).toBe("datago-air-quality-2"));
    await waitFor(() => expect(buildButton()).toBeEnabled());
    tables = [...tables, existingTable("datago-air-quality-2", 7)];

    fireEvent.click(buildButton());

    // Nothing was submitted; the step says what changed and now points at -3.
    await waitFor(() => expect(document.querySelector('[data-existing-table-changed="true"]')).not.toBeNull());
    expect(builder.submitted).toEqual([]);
    expect(shownSpec().dataset_id).toBe("datago-air-quality-3");
    expect(screen.getByRole("radio", { name: /새 테이블로 만들기/ })).toBeChecked();

    // Looked at again, the build goes under the id that is free now.
    fireEvent.click(buildButton());
    await screen.findByText("run=run-of-datago-air-quality-3");
    expect(builder.submitted).toEqual(["datago-air-quality-3"]);
  });

  it("asks once more at the build button and builds when nothing changed (#861)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const builder = builderWith(() => HttpResponse.json({ tables: [existingTable("datago-air-quality", 22)] }));

    await reachReview();
    await waitFor(() => expect(buildButton()).toBeEnabled());
    const asked = builder.listed();

    fireEvent.click(buildButton());

    await screen.findByText("run=run-of-datago-air-quality-2");
    expect(builder.listed()).toBe(asked + 1);
    expect(document.querySelector('[data-existing-table-changed="true"]')).toBeNull();
  });

  it("holds the build when the tables cannot be read at the button (#861)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    let reachable = true;
    const builder = builderWith(() =>
      reachable
        ? HttpResponse.json({ tables: [] })
        : HttpResponse.json({ error: "unavailable" }, { status: 503 }),
    );

    await reachReview();
    await waitFor(() => expect(buildButton()).toBeEnabled());
    reachable = false;

    fireEvent.click(buildButton());

    await waitFor(() => expect(document.querySelector('[data-existing-table="unknown"]')).not.toBeNull());
    expect(builder.submitted).toEqual([]);
    expect(buildButton()).toBeDisabled();
  });
});
