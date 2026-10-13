/**
 * A file upload answers for the selection it was started for, and no other (#987).
 *
 * The upload is slow and the person keeps going: picks another file, or another kind of
 * source. A response that arrives after that is for a selection that is gone — it must not
 * replace the file, the identity fields or the upload status of the one now chosen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AddDataPage } from "./AddDataPage";
import { OwnerScope } from "@/features/auth/OwnerScope";
import { useAuthStore } from "@/features/auth/store";
import { ApiError, type UploadMetadata } from "@/shared/lib/builderApi";
import { i18n } from "@/shared/i18n";
import { saveAddDataDraft } from "@/features/add-data/draftStorage";
import { INITIAL_DRAFT } from "@/features/add-data/model";

interface PendingUpload {
  file: File;
  signal: AbortSignal | undefined;
  resolve: (meta: UploadMetadata) => void;
  reject: (cause: unknown) => void;
}

const uploads: PendingUpload[] = [];

vi.mock("@/features/add-data/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/add-data/api")>();
  return {
    ...actual,
    uploadSourceFile: (file: File, _format: string, signal?: AbortSignal) =>
      new Promise<UploadMetadata>((resolve, reject) => {
        uploads.push({ file, signal, resolve, reject });
      }),
  };
});

const tr = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
/** A required field's label carries a marker after the text. */
const labelled = (key: string) => new RegExp(`^${tr(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

function meta(file: File, uploadId: string): UploadMetadata {
  return {
    upload_id: uploadId,
    format: "csv",
    encoding: "utf-8",
    size_bytes: file.size,
    original_filename: file.name,
    created_at: "2026-10-13T00:00:00.000Z",
  };
}

/** The page inside the boundary Layout puts it in: another account remounts it. */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/add"]}>
      <Routes>
        <Route
          path="/add"
          element={
            <OwnerScope>
              <AddDataPage />
            </OwnerScope>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function signInAs(userId: string) {
  act(() => {
    useAuthStore.getState().setOidcIdentity({
      email: `${userId}@example.test`,
      name: userId,
      userId,
      issuer: "https://idp.example.test/realms/kpubdata",
    });
  });
}

async function chooseFileSource() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(tr("addData.source.kindTitle.file")) }));
  fireEvent.change(await screen.findByLabelText(labelled("addData.configure.formatLabel")), { target: { value: "csv" } });
}

function pickFile(name: string): File {
  const file = new File(["a,b\n1,2\n"], name, { type: "text/csv" });
  fireEvent.change(screen.getByLabelText(labelled("addData.configure.fileLabel")), { target: { files: [file] } });
  return file;
}

const titleValue = () => (screen.getByLabelText(tr("addData.configure.titleLabel")) as HTMLInputElement).value;
const uploadedText = (name: string, bytes: number) => tr("addData.configure.uploadDone", { name, bytes });

beforeEach(() => {
  localStorage.clear();
  uploads.length = 0;
});

afterEach(() => {
  localStorage.clear();
  useAuthStore.getState().clear();
});

describe("AddDataPage — a late upload response does not replace the current selection (#987)", () => {
  it("keeps file B when A's upload answers after B's, and cancels A", async () => {
    renderPage();
    await chooseFileSource();
    const fileA = pickFile("alpha.csv");
    const fileB = pickFile("bravo.csv");
    expect(uploads).toHaveLength(2);
    // Picking B gives up on A: its request is aborted where the API can abort it.
    expect(uploads[0]?.signal?.aborted).toBe(true);
    expect(uploads[1]?.signal?.aborted).toBe(false);

    await act(async () => uploads[1]?.resolve(meta(fileB, "upl_bravo")));
    expect(screen.getByText(uploadedText("bravo.csv", fileB.size))).toBeInTheDocument();

    await act(async () => uploads[0]?.resolve(meta(fileA, "upl_alpha")));
    expect(screen.getByText(uploadedText("bravo.csv", fileB.size))).toBeInTheDocument();
    expect(screen.queryByText(uploadedText("alpha.csv", fileA.size))).toBeNull();
    expect(titleValue()).toMatch(/bravo/i);
  });

  it("shows no error when the superseded upload rejects as aborted", async () => {
    renderPage();
    await chooseFileSource();
    pickFile("alpha.csv");
    const fileB = pickFile("bravo.csv");

    await act(async () => uploads[0]?.reject(new DOMException("Aborted", "AbortError")));
    expect(screen.queryByText("Aborted")).toBeNull();
    expect(screen.getByText(tr("addData.configure.uploading"))).toBeInTheDocument();

    await act(async () => uploads[1]?.resolve(meta(fileB, "upl_bravo")));
    expect(screen.getByText(uploadedText("bravo.csv", fileB.size))).toBeInTheDocument();
  });

  it("does not let a pending upload fill the form after the source changed to a public API", async () => {
    renderPage();
    await chooseFileSource();
    const fileA = pickFile("alpha.csv");

    fireEvent.click(screen.getByRole("button", { name: new RegExp(tr("addData.source.kindTitle.publicApi")) }));
    expect(uploads[0]?.signal?.aborted).toBe(true);
    fireEvent.change(screen.getByLabelText(tr("addData.configure.titleLabel")), { target: { value: "api title" } });

    await act(async () => uploads[0]?.resolve(meta(fileA, "upl_alpha")));
    expect(titleValue()).toBe("api title");

    // Back on the file source, nothing claims A was uploaded or is still uploading.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(tr("addData.source.kindTitle.file")) }));
    expect(screen.queryByText(uploadedText("alpha.csv", fileA.size))).toBeNull();
    expect(screen.queryByText(tr("addData.configure.uploading"))).toBeNull();
  });

  it("does not let a pending upload fill a saved draft opened in its place", async () => {
    saveAddDataDraft({ ...INITIAL_DRAFT, sourceKind: "public_api", title: "saved draft" });
    renderPage();
    await chooseFileSource();
    const fileA = pickFile("alpha.csv");

    fireEvent.click(screen.getByRole("button", { name: tr("addData.draft.restore") }));
    expect(uploads[0]?.signal?.aborted).toBe(true);

    await act(async () => uploads[0]?.resolve(meta(fileA, "upl_alpha")));
    expect(titleValue()).toBe("saved draft");
  });

  it("still reports the current upload's quota refusal as a limit", async () => {
    renderPage();
    await chooseFileSource();
    pickFile("alpha.csv");
    pickFile("bravo.csv");

    const quota = new ApiError(409, "upload limit reached", { code: "upload_quota_exceeded" });
    // A's refusal arrives late: it belongs to a selection that is gone.
    await act(async () => uploads[0]?.reject(new ApiError(500, "stale refusal")));
    expect(screen.queryByText("stale refusal")).toBeNull();

    await act(async () => uploads[1]?.reject(quota));
    expect(screen.getByText("upload limit reached")).toHaveAttribute("role", "alert");
  });

  it("aborts a pending upload when another account signs in, and its answer fills nothing", async () => {
    signInAs("alice");
    renderPage();
    await chooseFileSource();
    const fileA = pickFile("alpha.csv");

    signInAs("bob");
    expect(uploads[0]?.signal?.aborted).toBe(true);

    await act(async () => uploads[0]?.resolve(meta(fileA, "upl_alpha")));
    expect(screen.queryByText(uploadedText("alpha.csv", fileA.size))).toBeNull();
    expect(screen.queryByText(/alpha/)).toBeNull();
  });

  it("aborts a pending upload when the page goes away", async () => {
    const view = renderPage();
    await chooseFileSource();
    pickFile("alpha.csv");
    view.unmount();
    expect(uploads[0]?.signal?.aborted).toBe(true);
  });
});
