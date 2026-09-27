/**
 * KubiRunAnalysis (#255 §2) — the Builds/Runs "Analyze this Run" inline card.
 *
 * No new Kubi engine — `useKubiSession` is reused as-is, so these tests
 * mock that hook and check the card shows exactly the right thing per turn
 * state: BYOK unset, loading-prep, in progress, answer arrived, error, and
 * stale-turn exclusion (#256 stale-context guard).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { UseKubiSessionResult } from "@/features/kubi/useKubiSession";
import type { KubiTurn } from "@/features/kubi/types";
import { KubiRunAnalysis } from "./KubiRunAnalysis";

const { useKubiSessionMock, useAssistConfigMock } = vi.hoisted(() => ({
  useKubiSessionMock: vi.fn(),
  useAssistConfigMock: vi.fn(),
}));

vi.mock("@/features/kubi/useKubiSession", async () => {
  const actual = await vi.importActual<typeof import("@/features/kubi/useKubiSession")>(
    "@/features/kubi/useKubiSession",
  );
  return { ...actual, useKubiSession: useKubiSessionMock };
});

vi.mock("@/features/assistant/config", () => ({
  useAssistConfig: useAssistConfigMock,
}));

function baseTurn(overrides: Partial<KubiTurn> = {}): KubiTurn {
  return {
    id: "turn-1",
    question: "Run run-1의 상태와 실패 원인을 분석해줘.",
    context: { page: "builds", runId: "run-1" },
    createdAt: "2026-08-18T00:00:00Z",
    status: "ok",
    query: { status: "idle" },
    actionStates: {},
    ...overrides,
  };
}

function session(overrides: Partial<UseKubiSessionResult> = {}): UseKubiSessionResult {
  return {
    liveContext: { page: "builds", runId: "run-1" },
    pageLabel: "Builds / Runs",
    onboarded: true,
    turns: [],
    isConfigured: true,
    isDemoAvailable: false,
    ask: vi.fn(),
    askDemo: vi.fn(),
    cancel: vi.fn(),
    isStale: () => false,
    executeQuery: vi.fn(),
    approveAction: vi.fn(),
    confirmApprovedAction: vi.fn(),
    rejectAction: vi.fn(),
    previewPatch: () => null,
    goToAction: vi.fn(),
    ...overrides,
  };
}

describe("KubiRunAnalysis", () => {
  it("asks the user to configure an API key when Kubi isn't configured and no demo is available", () => {
    useKubiSessionMock.mockReturnValue(session({ turns: [] }));
    useAssistConfigMock.mockReturnValue({ isConfigured: false });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("Kubi를 사용하려면 API Key 설정이 필요합니다.")).toBeInTheDocument();
    expect(screen.queryByText(/분석 준비 중/)).not.toBeInTheDocument();
  });

  it("does not let session.isDemoAvailable(mock Builder mode) bypass the no-key state (#286 후속 보완)", () => {
    // In mock Builder mode isDemoAvailable is always true, but the pending
    // seed is always consumed by the ordinary ask(), and ask() looks only at
    // isConfigured — so canAsk must key off isConfigured alone to prevent a
    // post-seed no_key error.
    useKubiSessionMock.mockReturnValue(session({ turns: [], isDemoAvailable: true }));
    useAssistConfigMock.mockReturnValue({ isConfigured: false });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("Kubi를 사용하려면 API Key 설정이 필요합니다.")).toBeInTheDocument();
    expect(screen.queryByText(/분석 준비 중/)).not.toBeInTheDocument();
    // In the no-key state, "Ask more" is not shown.
    expect(screen.queryByRole("button", { name: "더 질문하기" })).not.toBeInTheDocument();
  });

  it("no-key 상태에서는 이미 no_key로 실패한 turn이 있어도 ErrorNotice를 복제해서 보여주지 않는다", () => {
    const turn = baseTurn({ status: "error", error: { kind: "no_key" } });
    useKubiSessionMock.mockReturnValue(session({ turns: [turn], isDemoAvailable: true, isStale: () => false }));
    useAssistConfigMock.mockReturnValue({ isConfigured: false });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("Kubi를 사용하려면 API Key 설정이 필요합니다.")).toBeInTheDocument();
    expect(screen.queryByText("API Key가 설정되어 있지 않습니다. 위에서 먼저 설정하세요.")).not.toBeInTheDocument();
  });

  it("shows a preparing indicator while no matching turn exists yet", () => {
    useKubiSessionMock.mockReturnValue(session({ turns: [] }));
    useAssistConfigMock.mockReturnValue({ isConfigured: true });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("분석 준비 중…")).toBeInTheDocument();
  });

  it("shows the loading state with a cancel button while the turn is in flight", () => {
    const cancel = vi.fn();
    const turn = baseTurn({ status: "loading" });
    useKubiSessionMock.mockReturnValue(session({ turns: [turn], cancel, isStale: () => false }));
    useAssistConfigMock.mockReturnValue({ isConfigured: true });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("생각 중…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(cancel).toHaveBeenCalledWith("turn-1");
  });

  it("renders the answer as Markdown and surfaces evidence via the shared EvidenceSection (A2)", () => {
    const turn = baseTurn({
      status: "ok",
      evidence: {
        fetchedAt: "2026-08-18T00:00:00Z",
        context: { page: "builds", runId: "run-1" },
        deepLinks: {},
        unavailable: [],
        partial: false,
        stage: { refId: "run-1::air::silver", stage: "silver", source: "air", status: "failed", available: false, rowCount: null },
      } as KubiTurn["evidence"],
      response: {
        answer: "이 Run은 **source air**의 silver 단계에서 실패했습니다.",
        evidenceRefs: [{ kind: "stage", id: "run-1::air::silver", label: "air / silver" }],
        generatedSql: null,
        suggestedActions: [],
      },
    });
    useKubiSessionMock.mockReturnValue(session({ turns: [turn], isStale: () => false }));
    useAssistConfigMock.mockReturnValue({ isConfigured: true });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    // Reuses the same safe Markdown renderer as the Drawer — "**" never remains literal.
    expect(screen.getByText("source air").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*source air\*\*/)).not.toBeInTheDocument();

    // Evidence is provided by the same EvidenceSection (Disclosure) as KubiContent.
    fireEvent.click(screen.getByRole("button", { name: /근거 1개/ }));
    expect(screen.getByText("air / silver")).toBeInTheDocument();
  });

  it("surfaces rejected/hallucinated evidence even when the turn status is ok (A3)", () => {
    const turn = baseTurn({
      status: "ok",
      response: {
        answer: "요약된 정상 답변입니다.",
        evidenceRefs: [],
        generatedSql: null,
        suggestedActions: [],
      },
      error: {
        kind: "hallucinated_refs",
        message: "제외된 근거: run:ghost-run",
        rejectedRefs: ["run:ghost-run"],
        rejectedActions: [],
      },
    });
    useKubiSessionMock.mockReturnValue(session({ turns: [turn], isStale: () => false }));
    useAssistConfigMock.mockReturnValue({ isConfigured: true });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    // The normal answer stays visible, and
    expect(screen.getByText("요약된 정상 답변입니다.")).toBeInTheDocument();
    // the fact that evidence was excluded is not hidden (role="alert").
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("제외된 근거: run:ghost-run");
  });

  it("shows an error notice when the turn failed", () => {
    const turn = baseTurn({ status: "error", error: { kind: "llm_error", message: "LLM 호출 실패" } });
    useKubiSessionMock.mockReturnValue(session({ turns: [turn], isStale: () => false }));
    useAssistConfigMock.mockReturnValue({ isConfigured: true });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("LLM 호출 실패")).toBeInTheDocument();
  });

  it("does not show a stale turn from a previous Run's context", () => {
    const turn = baseTurn({
      status: "ok",
      response: { answer: "이전 run 분석 결과", evidenceRefs: [], generatedSql: null, suggestedActions: [] },
    });
    useKubiSessionMock.mockReturnValue(session({ turns: [turn], isStale: () => true }));
    useAssistConfigMock.mockReturnValue({ isConfigured: true });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.queryByText("이전 run 분석 결과")).not.toBeInTheDocument();
    expect(screen.getByText("분석 준비 중…")).toBeInTheDocument();
  });

  it("wires 닫기/더 질문하기 to onClose/onAskMore", () => {
    const onClose = vi.fn();
    const onAskMore = vi.fn();
    useKubiSessionMock.mockReturnValue(session({ turns: [] }));
    useAssistConfigMock.mockReturnValue({ isConfigured: true });

    render(<KubiRunAnalysis onClose={onClose} onAskMore={onAskMore} />);

    fireEvent.click(screen.getByText("닫기"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "더 질문하기" }));
    expect(onAskMore).toHaveBeenCalledTimes(1);
  });
});
