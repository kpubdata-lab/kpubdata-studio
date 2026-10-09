/**
 * The two build screens after a build that wanted a key (#787): the key is asked for on
 * the screen, the same spec is sent again, the new run names the attempt it retries —
 * and the key the user typed is nowhere but the tab's memory.
 *
 * The component and the hook have their own tests. These hold the lines of the two pages
 * that join them: what `job.start` is given the second time.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import * as runsApi from "@/features/runs/api";
import { AddDataPage } from "@/pages/AddDataPage";
import { NewBuildPage } from "@/pages/NewBuildPage";
import { ApiError } from "@/shared/lib/builderApi";
import { forgetAllProviderKeys, isProviderKeyHeld } from "@/shared/lib/providerKeys";
import type { BuildRun, BuildSpec } from "@/shared/lib/types";

const RUN_ID = "air-quality-edit-run";
const TYPED = "stand-in-typed-value-787";

const REFUSED = new ApiError(400, "this build calls datago, and the request carries no key for it", {
  error: "this build calls datago, and the request carries no key for it",
  code: "provider_credential_required",
  providers: ["datago"],
});

let executeBuild: MockInstance<typeof runsApi.executeBuild>;
let consoles: MockInstance[];

function lostRun(spec: BuildSpec): BuildRun {
  return {
    id: "attempt-1",
    spec,
    status: "failed",
    startedAt: "2026-10-07T00:00:00Z",
    finishedAt: "2026-10-07T00:00:01Z",
    error: "credentials_required: the server restarted and the job's provider keys are gone",
    keysLost: true,
  };
}

beforeEach(() => {
  clearBuildSpecs();
  saveBuildSpec(RUN_ID, {
    datasetId: "air-quality",
    title: "t",
    description: "d",
    sources: [{ provider: "datago", dataset: "air", params: {} }],
    exports: [{ format: "jsonl" }],
    metadata: { outputPath: "artifacts/builds/air-quality" },
  });
  executeBuild = vi.spyOn(runsApi, "executeBuild");
  consoles = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  clearBuildSpecs();
  forgetAllProviderKeys();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

/** The typed key is in the tab's memory and nowhere a later reader could find it. */
function expectKeyOnlyInMemory(): void {
  expect(isProviderKeyHeld("datago")).toBe(true);
  expect(document.body.innerHTML).not.toContain(TYPED);
  const stored = (storage: Storage) =>
    Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? "";
      return `${key}=${storage.getItem(key) ?? ""}`;
    }).join("\n");
  expect(stored(window.localStorage)).not.toContain(TYPED);
  expect(stored(window.sessionStorage)).not.toContain(TYPED);
  expect(document.cookie).not.toContain(TYPED);
  expect(window.location.href).not.toContain(TYPED);
  for (const spy of consoles) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TYPED);
  }
  // Nor in what the page hands the build: the key travels in a header, never in the spec.
  expect(JSON.stringify(executeBuild.mock.calls.map((call) => [call[0], call[4]]))).not.toContain(TYPED);
}

function enterKey(): void {
  const input = document.getElementById("missing-provider-key-datago") as HTMLInputElement;
  fireEvent.change(input, { target: { value: TYPED } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

async function editPageAtReview() {
  render(
    <MemoryRouter initialEntries={[`/refresh-jobs/${RUN_ID}/edit`]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId/edit" element={<NewBuildPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "기본 정보" }, { timeout: 8000 });
  for (const heading of ["데이터 소스", "파라미터", "미리보기", "출력 형식", "검증·실행"]) {
    next();
    await screen.findByRole("heading", { name: heading });
  }
  fireEvent.click(screen.getByRole("button", { name: "다시 검증" }));
  await screen.findByText("검증을 통과했습니다. 실행할 수 있습니다.");
}

function BuildDetailStub() {
  const { buildId } = useParams();
  return <div>Build 상세: run={buildId}</div>;
}

async function addDataAtReview() {
  render(
    <MemoryRouter initialEntries={["/add"]}>
      <Routes>
        <Route path="/add" element={<AddDataPage />} />
        <Route path="/refresh-jobs/:buildId" element={<BuildDetailStub />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /공공 API/ }));
  next();
  await screen.findByText("API 사용 준비");
  fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
  await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
  await screen.findByText("아파트 실거래가");
  next();
  await screen.findByRole("heading", { name: "Preview · 검증" });
  fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));
  next();
  await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
  const button = await screen.findByRole("button", { name: "테이블 만들기" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

const SCREENS: Array<[string, () => Promise<HTMLElement>]> = [
  [
    "the edit page",
    async () => {
      await editPageAtReview();
      return screen.getByRole("button", { name: "갱신" });
    },
  ],
  ["Add Data", addDataAtReview],
];

describe.each(SCREENS)("%s after a build that wanted a key (#787)", (_name, reachRunButton) => {
  it("a run that lost its keys is run again as a retry of that run, with the same spec", async () => {
    executeBuild.mockImplementationOnce(async (spec) => lostRun(spec));
    executeBuild.mockImplementationOnce(async (spec) => ({ ...lostRun(spec), id: "attempt-2", status: "succeeded", error: undefined, keysLost: undefined }));
    const runButton = await reachRunButton();

    fireEvent.click(runButton);
    await waitFor(() => expect(document.querySelector('[data-key-needed="datago"]')).not.toBeNull());
    enterKey();
    await waitFor(() => expect(document.querySelector('[data-key-held="datago"]')).not.toBeNull());
    expectKeyOnlyInMemory();

    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);
    await waitFor(() => expect(executeBuild).toHaveBeenCalledTimes(2));

    const [first, second] = executeBuild.mock.calls;
    // The spec the user had is the spec that goes again.
    expect(second![0]).toEqual(first![0]);
    // The new run says which attempt it retries; the first named no such attempt.
    expect(second![4]).toEqual({ retryOf: "attempt-1" });
    expect(first![4]?.retryOf).not.toBe("attempt-1");
    expectKeyOnlyInMemory();
  });

  it("a build refused for the key submitted nothing, so it goes again as it was — no retry link", async () => {
    executeBuild.mockRejectedValueOnce(REFUSED);
    executeBuild.mockImplementationOnce(async (spec) => ({ ...lostRun(spec), id: "run-ok", status: "succeeded", error: undefined, keysLost: undefined }));
    const runButton = await reachRunButton();

    fireEvent.click(runButton);
    await waitFor(() => expect(document.querySelector('[data-key-needed="datago"]')).not.toBeNull());
    enterKey();
    expectKeyOnlyInMemory();

    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);
    await waitFor(() => expect(executeBuild).toHaveBeenCalledTimes(2));

    const [first, second] = executeBuild.mock.calls;
    expect(second![0]).toEqual(first![0]);
    expect(second![4]).toEqual(first![4]);
    expectKeyOnlyInMemory();
  });

  it("an ordinary failure shows no key notice and is not asked for one", async () => {
    executeBuild.mockRejectedValueOnce(new ApiError(502, "provider client unavailable", { error: "provider client unavailable" }));
    const runButton = await reachRunButton();

    fireEvent.click(runButton);

    await screen.findByText("provider client unavailable");
    expect(document.querySelector("[data-missing-provider-keys]")).toBeNull();
  });

  it("pressing run twice while the first is still out sends one build", async () => {
    let release: (run: BuildRun) => void = () => undefined;
    executeBuild.mockImplementationOnce((spec) => new Promise<BuildRun>((resolve) => {
      release = () => resolve(lostRun(spec));
    }));
    const runButton = await reachRunButton();

    fireEvent.click(runButton);
    fireEvent.click(runButton);

    // The build is sent once the tables have been asked about again (#861), so not in
    // the same tick as the press — and still once for the two presses.
    await waitFor(() => expect(executeBuild).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(executeBuild).toHaveBeenCalledTimes(1);
    release(lostRun({} as BuildSpec));
    await waitFor(() => expect(document.querySelector("[data-missing-provider-keys]")).not.toBeNull());
  });
});
