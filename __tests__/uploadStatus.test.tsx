/**
 * Asking Builder about the upload a draft names (#758).
 *
 * A saved spec carries only an `upload_id`. In a multi-user deployment Builder deletes an
 * upload past its retention period, and the spec then fails to build. These pin what the
 * draft screen learns by asking: there until a date, already gone, or nothing new.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUploadStatus } from "@/features/add-data/useUploadStatus";
import { ApiError, builderApi } from "@/shared/lib/builderApi";

const ID = `upl_${"a".repeat(32)}`;
const META = {
  upload_id: ID,
  format: "csv" as const,
  encoding: "utf-8",
  size_bytes: 1,
  original_filename: "a.csv",
  created_at: "2026-10-01T00:00:00+00:00",
};

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useUploadStatus", () => {
  it("says until when Builder keeps the upload", async () => {
    vi.spyOn(builderApi, "getUpload").mockResolvedValue({ ...META, expires_at: "2026-10-31T00:00:00+00:00" });

    const { result } = renderHook(() => useUploadStatus(ID));

    await waitFor(() => expect(result.current).toEqual({ kind: "present", expiresAt: "2026-10-31T00:00:00+00:00" }));
  });

  it.each([[null], [undefined]])("an upload nothing will delete is present with no date (%s)", async (expiresAt) => {
    vi.spyOn(builderApi, "getUpload").mockResolvedValue(expiresAt === undefined ? META : { ...META, expires_at: expiresAt });

    const { result } = renderHook(() => useUploadStatus(ID));

    await waitFor(() => expect(result.current).toEqual({ kind: "present", expiresAt: null }));
  });

  it("a 404 means the upload is gone", async () => {
    vi.spyOn(builderApi, "getUpload").mockRejectedValue(new ApiError(404, "upload not found"));

    const { result } = renderHook(() => useUploadStatus(ID));

    await waitFor(() => expect(result.current).toEqual({ kind: "gone" }));
  });

  it.each([[500], [0], [403]])("a %s says nothing about the upload", async (status) => {
    const lookup = vi.spyOn(builderApi, "getUpload").mockRejectedValue(new ApiError(status, "no"));

    const { result } = renderHook(() => useUploadStatus(ID));

    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual({ kind: "unknown" });
  });

  it("asks nothing without an upload", () => {
    const lookup = vi.spyOn(builderApi, "getUpload");

    const { result } = renderHook(() => useUploadStatus(null));

    expect(lookup).not.toHaveBeenCalled();
    expect(result.current).toEqual({ kind: "unknown" });
  });

  it("asks nothing in the demo, which has no Builder", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    const lookup = vi.spyOn(builderApi, "getUpload");

    renderHook(() => useUploadStatus(ID));

    expect(lookup).not.toHaveBeenCalled();
  });

  it("asks again when the draft names another upload", async () => {
    const other = `upl_${"b".repeat(32)}`;
    const lookup = vi
      .spyOn(builderApi, "getUpload")
      .mockImplementation(async (id) => (id === ID ? { ...META, expires_at: null } : Promise.reject(new ApiError(404, "gone"))));

    const { result, rerender } = renderHook(({ id }) => useUploadStatus(id), { initialProps: { id: ID } });
    await waitFor(() => expect(result.current.kind).toBe("present"));
    rerender({ id: other });

    await waitFor(() => expect(result.current).toEqual({ kind: "gone" }));
    expect(lookup.mock.calls.map((call) => call[0])).toEqual([ID, other]);
  });
});

describe("GET /uploads/{upload_id}", () => {
  it("is asked once, by id, and read as upload metadata", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ ...META, expires_at: null }) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const meta = await builderApi.getUpload(ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(new RegExp(`/uploads/${ID}$`));
    expect(meta.expires_at).toBeNull();
  });

  it("does not retry a 404", async () => {
    const fetchMock = vi.fn(async () =>
      ({ ok: false, status: 404, headers: new Headers(), text: async () => JSON.stringify({ error: "upload not found" }) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(builderApi.getUpload(ID)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
