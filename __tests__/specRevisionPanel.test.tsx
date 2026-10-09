/**
 * The change history panel of the spec edit screen (#649, kpubdata-builder#820).
 *
 * Runs against Builder's revision endpoints through MSW: the edit's base is the latest
 * revision when editing starts, a save that someone else beat says so and offers the
 * latest content, Builder's credential refusal is shown, the history and audit trail are
 * listed as Builder sends them, and a revert becomes a new revision loaded into the form.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpecRevisionPanel } from "@/features/build-spec/components/SpecRevisionPanel";
import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import { toYamlText } from "@/features/build-spec/yamlText";
import { clearDemoRevisions } from "@/features/build-spec/specRevisions";
import { NewBuildPage } from "@/pages/NewBuildPage";
import { API_BASE } from "@/shared/config/env";
import type { DocumentRevision } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";
import { mswServer } from "../vitest.setup";

const SPEC: BuildSpec = {
  datasetId: "air-quality",
  title: "Air quality",
  description: "Hourly readings",
  sources: [{ provider: "datago", dataset: "air", params: { sidoName: "Seoul" } }],
  exports: [{ format: "jsonl" }],
  metadata: { outputPath: "artifacts/builds/air" },
};

// An obviously fake, low-entropy value: every case below puts it under a credential-named
// key (serviceKey, token, secret, access_token), which redaction catches by name alone,
// so no realistic-looking key is needed and the secret scanner has nothing to flag.
const FIXTURE_VALUE = "fixture-value-649";

function revision(number: number, overrides: Partial<DocumentRevision> = {}): DocumentRevision {
  return {
    kind: "spec",
    doc_id: "air-quality",
    revision: number,
    note: null,
    author: `owner-${number}`,
    created_at: `2026-10-0${number}T00:00:00+00:00`,
    reverted_from: null,
    ...overrides,
  };
}

interface Server {
  latest: number;
  puts: Record<string, unknown>[];
  reverts: Record<string, unknown>[];
  putResponse?: () => Response;
}

/** A Builder whose spec `air-quality` is at `latest`, recording what Studio sends. */
function builder(latest: number, history: DocumentRevision[]): Server {
  const server: Server = { latest, puts: [], reverts: [] };
  mswServer.use(
    http.get(`${API_BASE}/revisions/spec/:docId`, () =>
      server.latest === 0
        ? HttpResponse.json({ error: "no such spec", code: "revision_not_found" }, { status: 404 })
        : HttpResponse.json(
            revision(server.latest, { content: { yaml: toYamlText({ ...SPEC, title: `Title at ${server.latest}` }) } }),
          ),
    ),
    http.get(`${API_BASE}/revisions/spec/:docId/history`, () =>
      history.length === 0
        ? HttpResponse.json({ error: "no such spec", code: "revision_not_found" }, { status: 404 })
        : HttpResponse.json({
            revisions: history,
            audit: history.map((r) => ({
              revision: r.revision,
              action: r.reverted_from === null ? "save" : "revert",
              author: r.author,
              at: r.created_at,
            })),
          }),
    ),
    http.put(`${API_BASE}/revisions/spec/:docId`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      server.puts.push(body);
      if (server.putResponse) return server.putResponse();
      server.latest += 1;
      return HttpResponse.json(revision(server.latest, { content: body.content as DocumentRevision["content"] }));
    }),
    http.post(`${API_BASE}/revisions/spec/:docId/revert`, async ({ request }) => {
      const body = (await request.json()) as { to_revision: number; expected_revision: number };
      server.reverts.push(body);
      server.latest += 1;
      return HttpResponse.json(
        revision(server.latest, {
          note: `revert to revision ${body.to_revision}`,
          reverted_from: body.to_revision,
          content: { yaml: toYamlText({ ...SPEC, title: `Title at ${body.to_revision}` }) },
        }),
      );
    }),
  );
  return server;
}

/** `null` renders the panel with no valid spec, as when the form has an error. */
function renderPanel(spec: BuildSpec | null = SPEC) {
  const onLoad = vi.fn();
  render(
    <SpecRevisionPanel docId="air-quality" spec={spec ?? undefined} onLoad={onLoad} />,
  );
  return { onLoad };
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SpecRevisionPanel", () => {
  it("saves on top of the revision read when editing started", async () => {
    const server = builder(3, [revision(1), revision(2), revision(3)]);
    renderPanel();
    expect(await screen.findByText("편집 기준: 리비전 3")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("변경 메모 (선택)"), { target: { value: "region fix" } });
    fireEvent.click(screen.getByRole("button", { name: "리비전으로 저장" }));

    expect(await screen.findByText("저장했습니다 — 새 리비전 4")).toBeInTheDocument();
    expect(server.puts[0]).toMatchObject({ expected_revision: 3, note: "region fix" });
    // The next save builds on what this one made. The button is busy until the history reloads.
    await waitFor(() => expect(screen.getByRole("button", { name: "리비전으로 저장" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "리비전으로 저장" }));
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1].expected_revision).toBe(4);
  });

  it("starts a document with no revision at 0", async () => {
    const server = builder(0, []);
    renderPanel();
    expect(await screen.findByText(/아직 저장된 리비전이 없습니다/)).toBeInTheDocument();
    expect(await screen.findByText("아직 변경 이력이 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "리비전으로 저장" }));
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].expected_revision).toBe(0);
  });

  it("explains a 409 conflict and loads the latest revision on request", async () => {
    const server = builder(3, [revision(1), revision(2), revision(3)]);
    const { onLoad } = renderPanel();
    await screen.findByText("편집 기준: 리비전 3");

    // Someone else saves revision 4 meanwhile.
    server.putResponse = () =>
      HttpResponse.json({ error: "the document is at revision 4", code: "revision_conflict", current_revision: 4 }, { status: 409 });
    server.latest = 4;
    fireEvent.click(screen.getByRole("button", { name: "리비전으로 저장" }));

    const conflict = await screen.findByTestId("spec-revision-conflict");
    expect(conflict).toHaveTextContent("저장 충돌");
    expect(conflict).toHaveTextContent("다른 사람이 먼저 저장했습니다(현재 최신: 리비전 4)");
    expect(conflict).toHaveTextContent("이번 저장은 반영되지 않았습니다");

    fireEvent.click(screen.getByRole("button", { name: "최신 리비전 불러오기" }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect((onLoad.mock.calls[0][0] as BuildSpec).title).toBe("Title at 4");
    expect(await screen.findByText("편집 기준: 리비전 4")).toBeInTheDocument();

    server.putResponse = undefined;
    fireEvent.click(screen.getByRole("button", { name: "리비전으로 저장" }));
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1].expected_revision).toBe(4);
  });

  it("shows Builder's 400 credential_in_content refusal", async () => {
    const server = builder(1, [revision(1)]);
    renderPanel();
    await screen.findByText("편집 기준: 리비전 1");
    server.putResponse = () =>
      HttpResponse.json(
        { error: "credentials are never stored with a document; remove them from: content.yaml", code: "credential_in_content" },
        { status: 400 },
      );
    fireEvent.click(screen.getByRole("button", { name: "리비전으로 저장" }));
    const refusal = await screen.findByTestId("spec-revision-credential");
    expect(refusal).toHaveTextContent("자격 증명 포함");
    expect(refusal).toHaveTextContent("remove them from: content.yaml");
  });

  it("refuses a spec with a credential before any request", async () => {
    const server = builder(1, [revision(1)]);
    renderPanel({ ...SPEC, sources: [{ ...SPEC.sources[0], params: { serviceKey: FIXTURE_VALUE } }] });
    await screen.findByText("편집 기준: 리비전 1");
    fireEvent.click(screen.getByRole("button", { name: "리비전으로 저장" }));
    expect(await screen.findByTestId("spec-revision-credential")).toBeInTheDocument();
    expect(server.puts).toEqual([]);
  });

  it("lists revisions with server author, time and note, and the audit trail", async () => {
    builder(3, [revision(1, { note: "first" }), revision(2), revision(3, { reverted_from: 1, note: "revert to revision 1" })]);
    renderPanel();
    const list = await screen.findByRole("list", { name: "리비전 목록" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-revision"))).toEqual(["3", "2", "1"]);
    expect(items[0]).toHaveTextContent("최신");
    expect(items[0]).toHaveTextContent("리비전 1에서 되돌림");
    expect(items[0]).toHaveTextContent("owner-3");
    expect(items[1]).toHaveTextContent("메모 없음");
    expect(items[2]).toHaveTextContent("first");
    // The latest cannot be reverted to; the older ones can.
    expect(within(items[0]).queryByRole("button")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "감사 로그 (3건)" }));
    const audit = screen.getByRole("list", { name: "감사 로그" });
    expect(within(audit).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringMatching(/owner-1 · 저장 · 리비전 1$/),
      expect.stringMatching(/owner-2 · 저장 · 리비전 2$/),
      expect.stringMatching(/owner-3 · 되돌리기 · 리비전 3$/),
    ]);
  });

  it("reverts as a new revision and loads it into the form", async () => {
    const server = builder(3, [revision(1), revision(2), revision(3)]);
    const { onLoad } = renderPanel();
    await screen.findByText("편집 기준: 리비전 3");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "이 리비전으로 되돌리기 (리비전 1)" }));

    // The person is asked first, with the revision named.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("리비전 1의 내용으로 되돌릴까요?");
    expect(await screen.findByText(/리비전 1의 내용으로 되돌렸습니다 — 새 리비전 4/)).toBeInTheDocument();
    expect(server.reverts).toEqual([{ to_revision: 1, expected_revision: 3 }]);
    expect((onLoad.mock.calls[0][0] as BuildSpec).title).toBe("Title at 1");
    expect(screen.getByTestId("spec-revision-base")).toHaveTextContent("편집 기준: 리비전 4");
  });

  it("sends nothing and keeps the form when the revert is not confirmed", async () => {
    const server = builder(3, [revision(1), revision(2), revision(3)]);
    const { onLoad } = renderPanel();
    await screen.findByText("편집 기준: 리비전 3");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(await screen.findByRole("button", { name: "이 리비전으로 되돌리기 (리비전 1)" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    // Give a request that should not exist the chance to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.reverts).toEqual([]);
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.queryByText(/되돌렸습니다/)).toBeNull();
    expect(screen.getByTestId("spec-revision-base")).toHaveTextContent("편집 기준: 리비전 3");
  });

  it("does not save while the form has no valid spec", async () => {
    builder(1, [revision(1)]);
    renderPanel(null);
    await screen.findByText("편집 기준: 리비전 1");
    expect(screen.getByRole("button", { name: "리비전으로 저장" })).toBeDisabled();
    expect(screen.getByText(/폼에 오류가 있어 지금은 저장할 수 없습니다/)).toBeInTheDocument();
  });
});

describe("spec edit screen", () => {
  const RUN_ID = "air-quality-revisions-run";

  beforeEach(() => {
    vi.unstubAllEnvs();
    clearBuildSpecs();
    clearDemoRevisions();
    saveBuildSpec(RUN_ID, SPEC);
  });

  afterEach(() => {
    clearBuildSpecs();
    clearDemoRevisions();
  });

  it("saves the form's spec as a revision and fills the form from a revert", async () => {
    render(
      <MemoryRouter initialEntries={[`/refresh-jobs/${RUN_ID}/edit`]}>
        <Routes>
          <Route path="/refresh-jobs/:buildId/edit" element={<NewBuildPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "기본 정보" });
    expect(await screen.findByText(/아직 저장된 리비전이 없습니다/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "리비전으로 저장" });

    fireEvent.click(save);
    expect(await screen.findByText("저장했습니다 — 새 리비전 1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^제목/), { target: { value: "Renamed" } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(await screen.findByText("저장했습니다 — 새 리비전 2")).toBeInTheDocument();
    expect(screen.getByLabelText(/^제목/)).toHaveValue("Renamed");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "이 리비전으로 되돌리기 (리비전 1)" }));
    expect(await screen.findByText(/새 리비전 3\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^제목/)).toHaveValue("Air quality"));
  });
});
