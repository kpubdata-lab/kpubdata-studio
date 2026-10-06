/**
 * The upload list in the file source's configure step (#779).
 *
 * Verifies:
 * - an upload refused for the limit opens the list by itself, so "delete an upload you no
 *   longer need" has somewhere to go; any other upload error does not;
 * - deleting the upload this draft builds from lets the draft go of it, so the user is
 *   asked for a file again instead of building from one that is gone;
 * - demo (mock) mode shows no list: there is no Builder to ask;
 * - `isUploadLimitReached` reads Builder's 409 `upload_quota_exceeded` and nothing else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { mswServer } from "../../../../vitest.setup";
import { INITIAL_DRAFT, type AddDataDraft } from "@/features/add-data/model";
import { isUploadLimitReached } from "@/pages/AddDataPage";
import { API_BASE } from "@/shared/config/env";
import { ApiError } from "@/shared/lib/builderApi";
import { ConfigureStep, type UploadState } from "./ConfigureStep";

const CURRENT = "upl_" + "b".repeat(32);
const STORED = [
  {
    upload_id: CURRENT,
    format: "csv",
    encoding: "utf-8",
    size_bytes: 10,
    original_filename: "current.csv",
    created_at: "2026-10-06T00:00:00+00:00",
    expires_at: null,
  },
];

function renderFileStep(upload: UploadState, updateDraft = vi.fn()) {
  const draft: AddDataDraft = {
    ...INITIAL_DRAFT,
    sourceKind: "file",
    file: { ...INITIAL_DRAFT.file, uploadId: CURRENT, format: "csv", filename: "current.csv", sizeBytes: 10 },
  };
  render(
    <ConfigureStep
      draft={draft}
      updateDraft={updateDraft}
      catalog={{ status: "loaded", providers: [] }}
      upload={upload}
      onUploadFile={vi.fn()}
      providerConfigured={null}
      onConnectProvider={vi.fn()}
      yamlText=""
      onApplyYaml={vi.fn()}
    />,
  );
  return updateDraft;
}

let lists: number;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  lists = 0;
  mswServer.use(
    http.get(`${API_BASE}/uploads`, () => {
      lists += 1;
      return HttpResponse.json({ uploads: STORED });
    }),
    http.get(`${API_BASE}/uploads/:id`, () => HttpResponse.json(STORED[0])),
    http.delete(`${API_BASE}/uploads/:id`, () => HttpResponse.json({ deleted: true })),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the upload list in the configure step (#779)", () => {
  it("opens by itself when the upload was refused for the limit", async () => {
    renderFileStep({ status: "error", error: "upload limit reached", limitReached: true });

    expect(await screen.findByRole("button", { name: "current.csv 삭제" })).toBeInTheDocument();
    expect(lists).toBe(1);
  });

  it("stays closed for any other upload error", async () => {
    renderFileStep({ status: "error", error: "could not parse the file" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(lists).toBe(0);
    expect(screen.getByRole("button", { name: "내 업로드 보기" })).toHaveAttribute("aria-expanded", "false");
  });

  it("lets the draft go of an upload that was deleted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const updateDraft = renderFileStep({ status: "error", error: "upload limit reached", limitReached: true });

    fireEvent.click(await screen.findByRole("button", { name: "current.csv 삭제" }));

    await waitFor(() => expect(updateDraft).toHaveBeenCalled());
    const patch = updateDraft.mock.calls.at(-1)?.[0] as Partial<AddDataDraft>;
    expect(patch.file).toMatchObject({ uploadId: null, filename: null, sizeBytes: null });
    // The format the user chose is kept: only the file is gone.
    expect(patch.file?.format).toBe("csv");
  });

  it("shows no list in demo mode", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    renderFileStep({ status: "idle" });

    expect(screen.queryByRole("button", { name: "내 업로드 보기" })).toBeNull();
  });
});

describe("isUploadLimitReached", () => {
  it("reads Builder's 409 upload_quota_exceeded and nothing else", () => {
    const limit = new ApiError(409, "limit", { error: "limit", code: "upload_quota_exceeded" });
    expect(isUploadLimitReached(limit)).toBe(true);
    expect(isUploadLimitReached(new ApiError(409, "conflict", { error: "x", code: "run_id_ended" }))).toBe(false);
    expect(isUploadLimitReached(new ApiError(413, "too large", { error: "x", code: "upload_quota_exceeded" }))).toBe(false);
    expect(isUploadLimitReached(new ApiError(409, "plain"))).toBe(false);
    expect(isUploadLimitReached(new Error("upload_quota_exceeded"))).toBe(false);
  });
});
