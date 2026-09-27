/**
 * KubiRunAnalysis (#255 §2) — Builds/Runs "이 Run 분석" inline card.
 *
 * 새 Ask KPubData 엔진을 만들지 않고 `useKubiSession`을 그대로 재사용하므로, 여기서는 그 훅을 mock해
 * turn 상태별로 카드가 올바른 것만 보여주는지 확인한다: BYOK 미설정, 로딩 준비 중, 진행 중,
 * 답변 도착, 에러, 그리고 stale turn을 제외하는지(#256 stale-context guard).
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
  it("asks the user to configure an API key when Ask KPubData isn't configured and no demo is available", () => {
    useKubiSessionMock.mockReturnValue(session({ turns: [] }));
    useAssistConfigMock.mockReturnValue({ isConfigured: false });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("Ask KPubData 를 사용하려면 API Key 설정이 필요합니다.")).toBeInTheDocument();
    expect(screen.queryByText(/분석 준비 중/)).not.toBeInTheDocument();
  });

  it("does not let session.isDemoAvailable(mock Builder mode) bypass the no-key state (#286 후속 보완)", () => {
    // mock Builder 모드에서는 isDemoAvailable이 항상 true지만, pending seed는 항상 일반
    // ask()로 소비되고 ask()는 isConfigured만 본다 — canAsk도 isConfigured만 기준으로 판단해야
    // seed 후 no_key 에러가 뜨는 상황을 막을 수 있다.
    useKubiSessionMock.mockReturnValue(session({ turns: [], isDemoAvailable: true }));
    useAssistConfigMock.mockReturnValue({ isConfigured: false });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("Ask KPubData 를 사용하려면 API Key 설정이 필요합니다.")).toBeInTheDocument();
    expect(screen.queryByText(/분석 준비 중/)).not.toBeInTheDocument();
    // no-key 상태에서는 "더 질문하기"를 표시하지 않는다.
    expect(screen.queryByRole("button", { name: "더 질문하기" })).not.toBeInTheDocument();
  });

  it("no-key 상태에서는 이미 no_key로 실패한 turn이 있어도 ErrorNotice를 복제해서 보여주지 않는다", () => {
    const turn = baseTurn({ status: "error", error: { kind: "no_key" } });
    useKubiSessionMock.mockReturnValue(session({ turns: [turn], isDemoAvailable: true, isStale: () => false }));
    useAssistConfigMock.mockReturnValue({ isConfigured: false });

    render(<KubiRunAnalysis onClose={vi.fn()} onAskMore={vi.fn()} />);

    expect(screen.getByText("Ask KPubData 를 사용하려면 API Key 설정이 필요합니다.")).toBeInTheDocument();
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

    // Drawer와 동일한 안전 Markdown 렌더러를 재사용한다 — "**"는 리터럴로 남지 않는다.
    expect(screen.getByText("source air").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*source air\*\*/)).not.toBeInTheDocument();

    // 근거는 KubiContent와 동일한 EvidenceSection(Disclosure)로 제공된다.
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

    // 정상 answer는 그대로 보이고,
    expect(screen.getByText("요약된 정상 답변입니다.")).toBeInTheDocument();
    // 제외된 근거가 있었다는 사실은 숨기지 않는다(role="alert").
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
