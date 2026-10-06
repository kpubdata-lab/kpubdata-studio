/**
 * MyUploads (#779, kpubdata-builder#1067).
 *
 * Verifies:
 * - nothing is asked of Builder until the list is opened, and it opens by itself when the
 *   upload just failed for the limit;
 * - each upload shows its name, size, when it was uploaded and until when it is kept;
 * - deleting asks first, sends DELETE for that upload only, tells the page, and reloads;
 * - the upload this draft builds from is marked, and its confirmation says so;
 * - declining the confirmation deletes nothing;
 * - a failed load or delete shows a message and leaves the list as it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { mswServer } from "../../../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { MyUploads } from "./MyUploads";

const OLD = "upl_" + "a".repeat(32);
const CURRENT = "upl_" + "b".repeat(32);

function upload(id: string, name: string, expires: string | null = "2026-11-05T00:00:00+00:00") {
  return {
    upload_id: id,
    format: "csv",
    encoding: "utf-8",
    size_bytes: 1234,
    original_filename: name,
    created_at: "2026-10-06T00:00:00+00:00",
    expires_at: expires,
  };
}

interface Seen {
  lists: number;
  deleted: string[];
}

let seen: Seen;
let stored: ReturnType<typeof upload>[];

function mockBuilder({ deleteStatus = 200 }: { deleteStatus?: number } = {}) {
  mswServer.use(
    http.get(`${API_BASE}/uploads`, () => {
      seen.lists += 1;
      return HttpResponse.json({ uploads: stored });
    }),
    http.delete(`${API_BASE}/uploads/:id`, ({ params }) => {
      seen.deleted.push(String(params.id));
      if (deleteStatus !== 200) return HttpResponse.json({ error: "x" }, { status: deleteStatus });
      stored = stored.filter((item) => item.upload_id !== params.id);
      return HttpResponse.json({ deleted: true });
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  seen = { lists: 0, deleted: [] };
  stored = [upload(CURRENT, "current.csv"), upload(OLD, "old.csv", null)];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function open() {
  fireEvent.click(screen.getByRole("button", { name: "내 업로드 보기" }));
}

describe("MyUploads", () => {
  it("asks Builder nothing until it is opened", async () => {
    mockBuilder();
    render(<MyUploads currentUploadId={null} openNow={false} onDeleted={() => {}} />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen.lists).toBe(0);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("opens by itself when the upload just failed for the limit", async () => {
    mockBuilder();
    render(<MyUploads currentUploadId={null} openNow onDeleted={() => {}} />);

    expect(await screen.findByText("old.csv")).toBeInTheDocument();
    expect(seen.lists).toBe(1);
  });

  it("lists each upload with its size, date and retention, and marks the one in use", async () => {
    mockBuilder();
    render(<MyUploads currentUploadId={CURRENT} openNow={false} onDeleted={() => {}} />);
    open();

    const current = (await screen.findByText("current.csv")).closest("li") as HTMLElement;
    expect(within(current).getByText("(지금 이 초안이 쓰는 파일)")).toBeInTheDocument();
    expect(current).toHaveTextContent("1234 bytes");
    expect(current).toHaveTextContent("까지 보관");
    const old = screen.getByText("old.csv").closest("li") as HTMLElement;
    // No retention date: nothing is said about when it goes.
    expect(old).not.toHaveTextContent("까지 보관");
    expect(within(old).queryByText("(지금 이 초안이 쓰는 파일)")).toBeNull();
  });

  it("deletes one upload after asking, tells the page and reloads", async () => {
    mockBuilder();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDeleted = vi.fn();
    render(<MyUploads currentUploadId={CURRENT} openNow={false} onDeleted={onDeleted} />);
    open();
    await screen.findByText("old.csv");

    fireEvent.click(screen.getByRole("button", { name: "old.csv 삭제" }));

    await waitFor(() => expect(screen.queryByText("old.csv")).toBeNull());
    expect(seen.deleted).toEqual([OLD]);
    expect(onDeleted).toHaveBeenCalledWith(OLD);
    expect(confirm.mock.calls[0][0]).toContain("old.csv");
    expect(confirm.mock.calls[0][0]).not.toContain("초안이 쓰는 파일");
    expect(screen.getByText("current.csv")).toBeInTheDocument();
    expect(seen.lists).toBe(2);
  });

  it("says so when the upload to delete is the one this draft uses", async () => {
    mockBuilder();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MyUploads currentUploadId={CURRENT} openNow={false} onDeleted={() => {}} />);
    open();
    await screen.findByText("current.csv");

    fireEvent.click(screen.getByRole("button", { name: "current.csv 삭제" }));

    await waitFor(() => expect(seen.deleted).toEqual([CURRENT]));
    expect(confirm.mock.calls[0][0]).toContain("초안이 쓰는 파일");
  });

  it("deletes nothing when the confirmation is declined", async () => {
    mockBuilder();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onDeleted = vi.fn();
    render(<MyUploads currentUploadId={null} openNow={false} onDeleted={onDeleted} />);
    open();
    await screen.findByText("old.csv");

    fireEvent.click(screen.getByRole("button", { name: "old.csv 삭제" }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(seen.deleted).toEqual([]);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByText("old.csv")).toBeInTheDocument();
  });

  it("keeps the list and says so when a delete fails", async () => {
    mockBuilder({ deleteStatus: 500 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDeleted = vi.fn();
    render(<MyUploads currentUploadId={null} openNow={false} onDeleted={onDeleted} />);
    open();
    await screen.findByText("old.csv");

    fireEvent.click(screen.getByRole("button", { name: "old.csv 삭제" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("지우지 못했습니다");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByText("old.csv")).toBeInTheDocument();
  });

  it("says so when the list cannot be loaded, and when there is nothing uploaded", async () => {
    mswServer.use(http.get(`${API_BASE}/uploads`, () => HttpResponse.json({ error: "x" }, { status: 500 })));
    const { unmount } = render(<MyUploads currentUploadId={null} openNow onDeleted={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    unmount();

    stored = [];
    mockBuilder();
    render(<MyUploads currentUploadId={null} openNow onDeleted={() => {}} />);
    expect(await screen.findByText("올려 둔 파일이 없습니다.")).toBeInTheDocument();
  });
});
