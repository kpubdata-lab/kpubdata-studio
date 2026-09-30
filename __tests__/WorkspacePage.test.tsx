/**
 * WorkspacePage (#260) — Recent Work(Dataset/Build/Report/Saved BuildSpec 병합, 정확한
 * id 라우팅, Builder 부분 실패 시에도 로컬 항목 유지)와 Saved BuildSpecs(열기/복제/삭제/
 * 이름변경, 새로고침 후 복구)를 확인한다.
 *
 * 저장된 항목은 Recent Work와 Saved BuildSpecs 두 섹션에 동시에 나타나는 게 정상 동작이라
 * (같은 데이터를 다른 관점으로 보여줌), 존재 확인은 대부분 getAllByText/findAllByText로 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspacePage } from "@/pages/WorkspacePage";
import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import { createSavedSpec, listSavedSpecSummaries } from "@/features/workspace/savedSpecs";
import type { BuildSpec } from "@/shared/lib/types";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <WorkspacePage />
    </MemoryRouter>,
  );
}

function makeSpec(overrides: Partial<BuildSpec> = {}): BuildSpec {
  return {
    datasetId: "datago-air-quality",
    title: "대기오염 정보",
    description: "설명",
    sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
    exports: [{ format: "jsonl" }],
    metadata: { outputPath: "artifacts/builds/air-quality" },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  navigateMock.mockClear();
  vi.restoreAllMocks();
});

describe("Recent Work", () => {
  it("shows mock Builder datasets/builds alongside local Saved BuildSpecs, tagged by kind and source", async () => {
    createSavedSpec({ name: "내 스펙", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    renderWorkspace();

    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
    expect((await screen.findAllByText("내 스펙")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Table").length + screen.getAllByText("Run").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saved BuildSpec").length).toBeGreaterThan(0);
    expect(screen.getAllByText("이 브라우저").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KPubData Builder").length).toBeGreaterThan(0);
  });

  it("navigates to the item's exact href when clicked, not by title/position", async () => {
    createSavedSpec({ name: "내 스펙", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    renderWorkspace();

    const matches = await screen.findAllByText("내 스펙");
    fireEvent.click(matches[0]);
    const [href] = navigateMock.mock.calls.at(-1)!;
    expect(href).toMatch(/^\/add\?savedSpecId=/);
  });

  it("shows a new-user empty state when Builder and local storage are both empty", async () => {
    vi.spyOn(datasetsApi, "listDatasets").mockResolvedValue([]);
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([]);
    renderWorkspace();

    expect(await screen.findByText("아직 작업이 없습니다")).toBeInTheDocument();
  });

  it("shows a dataset-load error with retry while still keeping local Saved BuildSpecs visible", async () => {
    createSavedSpec({ name: "로컬 항목 유지됨", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    vi.spyOn(datasetsApi, "listDatasets").mockRejectedValue(new Error("Dataset 조회 실패"));
    renderWorkspace();

    expect(await screen.findByText("테이블 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("Dataset 조회 실패")).toBeInTheDocument();
    // Builder dataset 조회가 실패해도 로컬 Saved BuildSpec은 그대로 보인다.
    expect(screen.getAllByText("로컬 항목 유지됨").length).toBeGreaterThan(0);
  });

  it("retries the failed dataset load without affecting the build load", async () => {
    const spy = vi.spyOn(datasetsApi, "listDatasets").mockRejectedValueOnce(new Error("일시 오류"));
    renderWorkspace();
    await screen.findByText("테이블 목록을 불러오지 못했습니다");

    spy.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(screen.queryByText("테이블 목록을 불러오지 못했습니다")).not.toBeInTheDocument());
  });

  it("shows the local-storage-limitation notice", async () => {
    renderWorkspace();
    expect(await screen.findByText("이 브라우저에만 저장됩니다")).toBeInTheDocument();
  });
});

describe("Saved BuildSpecs", () => {
  it("shows an empty state with a link to Create Table when nothing is saved", async () => {
    renderWorkspace();
    expect(await screen.findByText("저장된 BuildSpec이 없습니다")).toBeInTheDocument();
  });

  it("summarizes name/provider/output/validation for each saved spec", async () => {
    createSavedSpec({ name: "요약 확인", spec: makeSpec(), validation: { status: "validated_fail", errors: ["문제"] } });
    renderWorkspace();

    expect((await screen.findAllByText("요약 확인")).length).toBeGreaterThan(0);
    expect(screen.getByText("datago")).toBeInTheDocument();
    expect(screen.getByText("artifacts/builds/air-quality", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("검증 실패")).toBeInTheDocument();
  });

  it("renames a saved spec inline", async () => {
    createSavedSpec({ name: "원래 이름", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    renderWorkspace();
    await screen.findAllByText("원래 이름");

    fireEvent.click(screen.getAllByText("이름변경")[0]);
    const input = screen.getByDisplayValue("원래 이름");
    fireEvent.change(input, { target: { value: "새 이름" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getAllByText("새 이름").length).toBeGreaterThan(0));
    expect(listSavedSpecSummaries()[0].name).toBe("새 이름");
  });

  it("duplicates a saved spec with a new id and (복제본) suffix", async () => {
    createSavedSpec({ name: "복제 대상", spec: makeSpec(), validation: { status: "validated_pass", errors: [] } });
    renderWorkspace();
    await screen.findAllByText("복제 대상");

    fireEvent.click(screen.getAllByText("복제")[0]);

    await waitFor(() => expect(screen.getAllByText("복제 대상 (복제본)").length).toBeGreaterThan(0));
    expect(listSavedSpecSummaries()).toHaveLength(2);
  });

  it("deletes a saved spec after confirmation", async () => {
    createSavedSpec({ name: "삭제 대상", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkspace();
    await screen.findAllByText("삭제 대상");

    fireEvent.click(screen.getAllByText("삭제")[0]);

    await waitFor(() => expect(screen.queryByText("삭제 대상")).not.toBeInTheDocument());
    expect(listSavedSpecSummaries()).toHaveLength(0);
  });

  it("keeps the entry when the delete confirmation is cancelled", async () => {
    createSavedSpec({ name: "취소됨", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace();
    await screen.findAllByText("취소됨");

    fireEvent.click(screen.getAllByText("삭제")[0]);

    expect(screen.getAllByText("취소됨").length).toBeGreaterThan(0);
    expect(listSavedSpecSummaries()).toHaveLength(1);
  });
});

describe("reload persistence", () => {
  it("shows a previously-saved spec again after a simulated reload (fresh render)", async () => {
    createSavedSpec({ name: "새로고침 후에도 유지", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });

    const first = renderWorkspace();
    await screen.findAllByText("새로고침 후에도 유지");
    first.unmount();

    renderWorkspace();
    expect((await screen.findAllByText("새로고침 후에도 유지")).length).toBeGreaterThan(0);
  });
});
