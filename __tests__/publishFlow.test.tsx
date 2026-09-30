import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describePublishFailure,
  isSafePublishReference,
  publishBuild,
  validatePublishDestination,
} from "@/features/publish/api";
import { BuildPublishPage } from "@/pages/BuildPublishPage";
import { ApiError } from "@/shared/lib/builderApi";

const READY = {
  run_id: "run-7",
  target: "huggingface" as const,
  ready: true,
  blockers: [],
  warnings: [],
};

const SUCCESS = {
  run_id: "run-7",
  target: "huggingface" as const,
  publisher: "huggingface",
  destination: "owner/dataset",
  reference: "https://huggingface.co/datasets/owner/dataset",
  artifact_count: 3,
  status: "ok",
};

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function renderPublish(path = "/refresh-jobs/run-7/publish") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/refresh-jobs/:buildId/publish" element={<BuildPublishPage />} /></Routes>
    </MemoryRouter>,
  );
}

function mockReadyFetch(publishResponse: Response = response(200, SUCCESS)) {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    if (init.method === "POST") return Promise.resolve(publishResponse);
    return Promise.resolve(response(200, READY));
  });
}

async function fillAndConfirm() {
  await screen.findByText("Builder 게시 준비 완료");
  fireEvent.change(screen.getByLabelText("Hugging Face destination"), { target: { value: "owner/dataset" } });
  fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
  return screen.getByRole("button", { name: "게시 실행" });
}

// 이 스위트는 Builder HTTP 계약(POST body, 502/403/404/network 분류, 경합 방지)을 실제
// fetch mock으로 직접 검증한다 — getPublishReadiness/publishBuild가 mock/real 스위치 없이
// 항상 fetch를 거치던 시절 그대로였다. UI audit #4에서 다른 Builder 연동 엔드포인트와
// 동일하게 mock/real 분기를 추가했으므로(features/publish/api/index.ts), 이 스위트가 계속
// 실제 fetch 경로를 검증하도록 real 모드로 명시한다 — "false"였다면 이제 결정적 mock
// fixture(features/publish/api/mockData.ts)를 타서 아래 fetch mock들이 전혀 호출되지 않는다.
beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("publish contract API (#270 / builder #547)", () => {
  it("POSTs the exact contract payload and parses the actual Builder response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, SUCCESS));
    vi.stubGlobal("fetch", fetchMock);
    const request = { target: "huggingface" as const, destination: "owner/dataset", options: { private: false } };

    await expect(publishBuild("run-7", request)).resolves.toEqual(SUCCESS);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/builds/run-7/publish");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it("does not automatically retry a 502 publish response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(502, { error: "publish failed", code: "publish_failed" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(publishBuild("run-7", { target: "huggingface", destination: "owner/dataset" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["publish_in_progress", "이미 진행 중"],
    ["publish_state_unknown", "자동 재시도가 차단"],
    ["publish_conflict", "다른 공개 설정"],
  ] as const)("distinguishes 409 %s", (code, message) => {
    expect(describePublishFailure(new ApiError(409, "raw", { error: "raw", code }))).toMatchObject({ kind: code, message: expect.stringContaining(message) });
  });

  it("treats an un-coded 409 as a TOCTOU readiness change", () => {
    expect(describePublishFailure(new ApiError(409, "raw", { error: "raw", blockers: [] }))).toMatchObject({
      kind: "readiness_changed",
      message: expect.stringContaining("다시 확인"),
    });
  });

  it("validates only Builder's owner/dataset destination shape", () => {
    expect(validatePublishDestination("")).toBeDefined();
    expect(validatePublishDestination("../escape")).toBeDefined();
    expect(validatePublishDestination("owner/dataset")).toBeUndefined();
  });

  it("links only http/https references", () => {
    expect(isSafePublishReference("https://example.test/dataset")).toBe(true);
    expect(isSafePublishReference("javascript:alert(1)")).toBe(false);
    expect(isSafePublishReference("internal-reference")).toBe(false);
  });
});

describe("BuildPublishPage readiness and form (#270)", () => {
  it("shows loading, ready, warnings, and Hugging Face-only form with private=true default", async () => {
    let resolveReadiness!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveReadiness = resolve; })));
    renderPublish();
    expect(screen.getByText("KPubData Builder readiness").parentElement?.parentElement).toHaveTextContent("다시 확인");
    await act(() => resolveReadiness(response(200, { ...READY, warnings: [{ code: "notice", message: "검토 권장" }] })));
    expect(await screen.findByText("Builder 게시 준비 완료")).toBeInTheDocument();
    expect(screen.getByText("검토 권장")).toBeInTheDocument();
    expect(screen.getByLabelText("비공개 Dataset")).toBeChecked();
    expect(screen.queryByText(/Kaggle|Local only/)).not.toBeInTheDocument();
  });

  it("renders blockers and makes zero POST requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {
      ...READY,
      ready: false,
      blockers: [{ code: "credential_unavailable", message: "server credential missing" }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    expect(await screen.findByText("server credential missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "최종 확인" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
    expect(screen.getByText(/source Provider credential이 아니라/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /token|credential/i })).not.toBeInTheDocument();
  });

  it.each([
    [403, "권한이 없습니다"],
    [404, "찾을 수 없습니다"],
  ])("keeps readiness HTTP %s distinct", async (status, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status, { error: "<b>raw secret html</b>" })));
    renderPublish();
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.queryByText(/raw secret html/)).not.toBeInTheDocument();
  });

  it("shows a sanitized network readiness error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("token=hf_raw_secret")));
    renderPublish();
    expect(await screen.findByRole("alert", {}, { timeout: 5_000 })).toHaveTextContent("Builder 응답을 받지 못했습니다");
    expect(screen.queryByText(/hf_raw_secret/)).not.toBeInTheDocument();
  });

  it("blocks empty/invalid destination, accepts valid destination, and resets confirmation on edits", async () => {
    vi.stubGlobal("fetch", mockReadyFetch());
    renderPublish();
    await screen.findByText("Builder 게시 준비 완료");
    const review = screen.getByRole("button", { name: "최종 확인" });
    expect(review).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Hugging Face destination"), { target: { value: "bad" } });
    expect(review).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Hugging Face destination"), { target: { value: "owner/dataset" } });
    expect(review).toBeEnabled();
    fireEvent.click(screen.getByLabelText("비공개 Dataset"));
    fireEvent.click(review);
    expect(screen.getByLabelText("게시 최종 확인")).toHaveTextContent("Public");
    fireEvent.click(screen.getByRole("button", { name: "설정 수정" }));
    fireEvent.change(screen.getByLabelText("Hugging Face destination"), { target: { value: "owner/changed" } });
    expect(screen.queryByLabelText("게시 최종 확인")).not.toBeInTheDocument();
  });

  it("does not POST before confirmation and sends one exact POST after immediate double click", async () => {
    const fetchMock = mockReadyFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    const execute = await fillAndConfirm();
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
    fireEvent.click(execute);
    fireEvent.click(execute);
    await screen.findByText("Builder 게시 완료");
    const posts = fetchMock.mock.calls.filter(([, init]) => init.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1].body)).toEqual({ target: "huggingface", destination: "owner/dataset", options: { private: true } });
  });

  it("shows success only after 200 and uses a safe returned reference link", async () => {
    let resolvePost!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => init.method === "POST"
      ? new Promise<Response>((resolve) => { resolvePost = resolve; })
      : Promise.resolve(response(200, READY)));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    fireEvent.click(await fillAndConfirm());
    expect(screen.queryByText("Builder 게시 완료")).not.toBeInTheDocument();
    await waitFor(() => expect(resolvePost).toBeTypeOf("function"));
    await act(() => resolvePost(response(200, SUCCESS)));
    const success = await screen.findByText("Builder 게시 완료");
    const card = success.closest("div.rounded-xl") ?? success.parentElement!;
    expect(within(card as HTMLElement).getByRole("link")).toHaveAttribute("href", SUCCESS.reference);
    expect(screen.queryByText(/version|commit SHA|completed_at/i)).not.toBeInTheDocument();
  });

  it("renders an unsafe returned reference as text, never as a link", async () => {
    const unsafe = response(200, { ...SUCCESS, reference: "javascript:alert(1)" });
    vi.stubGlobal("fetch", mockReadyFetch(unsafe));
    renderPublish();
    fireEvent.click(await fillAndConfirm());
    expect(await screen.findByText("javascript:alert(1)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).not.toBeInTheDocument();
  });

  it("describes abort as stopping response wait, not remote cancellation", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => init.method === "POST"
      ? new Promise<Response>(() => {})
      : Promise.resolve(response(200, READY)));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    fireEvent.click(await fillAndConfirm());
    fireEvent.click(screen.getByRole("button", { name: "응답 기다리기 중단" }));
    expect(await screen.findByText("응답 대기를 중단했습니다.")).toBeInTheDocument();
    expect(screen.getByText(/원격 게시 작업을 취소한 것은 아닙니다/)).toBeInTheDocument();
    expect(screen.queryByText("게시가 취소되었습니다.")).not.toBeInTheDocument();
  });

  it("does not show an old Run's publish success after navigation", async () => {
    let resolveOldPost!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "POST") return new Promise<Response>((resolve) => { resolveOldPost = resolve; });
      const requestedRun = url.includes("run-2") ? "run-2" : "run-7";
      return Promise.resolve(response(200, { ...READY, run_id: requestedRun }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/refresh-jobs/run-7/publish"]}>
        <NavigationButton />
        <Routes><Route path="/refresh-jobs/:buildId/publish" element={<BuildPublishPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await fillAndConfirm());
    fireEvent.click(screen.getByRole("button", { name: "run 2" }));
    await screen.findByText("run-2 게시");
    await act(() => resolveOldPost(response(200, SUCCESS)));
    expect(screen.queryByText("Builder 게시 완료")).not.toBeInTheDocument();
  });
});

function NavigationButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/refresh-jobs/run-2/publish")}>run 2</button>;
}

describe("readiness stale response protection (#270)", () => {
  it("does not let an older Run response overwrite the newly selected Run", async () => {
    let resolveOld!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("run-1")) return new Promise<Response>((resolve) => { resolveOld = resolve; });
      return Promise.resolve(response(200, { ...READY, run_id: "run-2", warnings: [{ code: "new", message: "new run warning" }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/refresh-jobs/run-1/publish"]}>
        <NavigationButton />
        <Routes><Route path="/refresh-jobs/:buildId/publish" element={<BuildPublishPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "run 2" }));
    expect(await screen.findByText("new run warning")).toBeInTheDocument();
    await act(() => resolveOld(response(200, { ...READY, run_id: "run-1", warnings: [{ code: "old", message: "old run warning" }] })));
    expect(screen.queryByText("old run warning")).not.toBeInTheDocument();
    expect(screen.getByText("new run warning")).toBeInTheDocument();
  });
});
