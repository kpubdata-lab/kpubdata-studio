/**
 * PATCH_BUILDSPEC "BuildSpec 변경 제안" type badge 테스트 (Phase 2 UI polish).
 *
 * ActionCard(AssistantContent.tsx)에 badge를 추가한 변경이 (1) PATCH_BUILDSPEC에만 표시되고 다른
 * action type에는 새지 않는지, (2) 기존 승인(pending_approval → approve → preview/SpecDiff →
 * confirm) semantics를 그대로 유지하는지 확인한다. approve/preview/confirm 로직 자체는 이미
 * `assistantSession.test.tsx`(#256 리뷰 §10)가 hook 레벨에서 충분히 검증하므로, 여기서는 그 흐름을
 * 실제 DOM(AssistantPage)에서 재확인하며 badge assertion만 추가한다.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistConfig } from "@/features/assistant/config";
import { createProvider } from "@/features/assistant/provider";
import { saveBuildSpec } from "@/features/build-spec/specStore";
import type { BuildSpec } from "@/shared/lib/types";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { AssistantPage } from "@/pages/AssistantPage";

vi.mock("@/features/assistant/provider", () => ({
  createProvider: vi.fn(),
}));

const BADGE_TEXT = "BuildSpec 변경 제안";

const SPEC: BuildSpec = {
  datasetId: "air-quality",
  title: "대기질",
  description: "설명",
  sources: [{ provider: "data.go.kr", dataset: "air", params: { region: "서울" } }],
  exports: [{ format: "jsonl" }],
  metadata: { note: "orig" },
};

function jsonText(payload: unknown): AsyncIterable<string> {
  return (async function* () {
    yield "```json\n" + JSON.stringify(payload) + "\n```";
  })();
}

function mockStream(stream: (messages: unknown, signal?: AbortSignal) => AsyncIterable<string>) {
  vi.mocked(createProvider).mockReturnValue({
    isConfigured: true,
    stream,
  } as unknown as ReturnType<typeof createProvider>);
}

function configureKey() {
  act(() => {
    useAssistConfig.getState().setConfig({ apiKey: "sk-test-key", model: "gpt-4o-mini", baseUrl: "" });
  });
}

function renderAssistantPage() {
  render(
    <MemoryRouter initialEntries={["/datasets/air-quality?run=air-2026-08-14"]}>
      <AssistantPage />
    </MemoryRouter>,
  );
}

function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Ask KPubData 에 질문하기"), { target: { value: question } });
  fireEvent.submit(screen.getByLabelText("Ask KPubData 에 질문하기").closest("form")!);
}

beforeEach(() => {
  useAssistantStore.setState({ turns: [], onboarded: false, pendingSeed: null });
  useAssistConfig.getState().clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Ask KPubData PATCH_BUILDSPEC badge (#Phase2 UI polish)", () => {
  it("shows the 'BuildSpec 변경 제안' badge only on the PATCH_BUILDSPEC action card", async () => {
    saveBuildSpec("air-2026-08-14", SPEC);
    configureKey();
    mockStream(() =>
      jsonText({
        answer: "확인했습니다.",
        evidenceRefs: [],
        generatedSql: null,
        suggestedActions: [
          {
            type: "PATCH_BUILDSPEC",
            runId: "air-2026-08-14",
            patch: [{ op: "replace", path: "/metadata/note", value: "assistant-updated" }],
            reason: "이 문제 설명 보기 참고",
          },
          { type: "OPEN_BUILD", runId: "air-2026-08-14", reason: "실패 원인을 확인하세요" },
          { type: "ADD_REPORT_BLOCK", note: "참고 노트", reason: "품질 이슈 참고용" },
        ],
      }),
    );
    renderAssistantPage();
    ask("이 run에 대해 알려줘");

    // 세 action card가 모두 뜰 때까지 기다린다(승인 버튼 두 개 + PATCH_BUILDSPEC 승인 버튼).
    const approveButtons = await screen.findAllByRole("button", { name: "승인" });
    expect(approveButtons).toHaveLength(3);

    // badge는 정확히 한 번, PATCH_BUILDSPEC action card 안에만 나타난다.
    expect(screen.getAllByText(BADGE_TEXT)).toHaveLength(1);

    const patchCard = screen.getByText(/BuildSpec에 1건 변경 제안/).closest("div")!;
    expect(within(patchCard).getByText(BADGE_TEXT)).toBeInTheDocument();

    const openBuildCard = screen.getByText(/Build "air-2026-08-14" 상세 열기/).closest("div")!;
    expect(within(openBuildCard).queryByText(BADGE_TEXT)).not.toBeInTheDocument();

    const reportCard = screen.getByText("Report 참고 노트로 추가").closest("div")!;
    expect(within(reportCard).queryByText(BADGE_TEXT)).not.toBeInTheDocument();
  });

  it("badge 표시가 pending_approval → approve → preview/SpecDiff → confirm 흐름을 바꾸지 않는다", async () => {
    saveBuildSpec("air-2026-08-14", SPEC);
    configureKey();
    mockStream(() =>
      jsonText({
        answer: "metadata에 참고 노트를 추가하는 patch를 제안합니다.",
        evidenceRefs: [],
        generatedSql: null,
        suggestedActions: [
          {
            type: "PATCH_BUILDSPEC",
            runId: "air-2026-08-14",
            patch: [{ op: "replace", path: "/metadata/note", value: "assistant-updated" }],
            reason: "이 문제 설명 보기 참고",
          },
        ],
      }),
    );
    renderAssistantPage();
    ask("metadata에 노트 추가해줘");

    // pending_approval: badge와 승인 버튼이 함께 보이고, 아직 diff는 보이지 않는다.
    expect(await screen.findByText(BADGE_TEXT)).toBeInTheDocument();
    const approveButton = screen.getByRole("button", { name: "승인" });
    expect(screen.queryByText("metadata.note")).not.toBeInTheDocument();

    // approve → SpecDiff 미리보기가 뜬다(적용 전). diff 값은 "orig → assistant-updated"처럼 여러 text
    // node로 쪼개져 렌더되므로, 바뀐 경로(metadata.note) 행 전체의 textContent로 확인한다.
    fireEvent.click(approveButton);
    const diffRow = (await screen.findByText("metadata.note")).closest("li")!;
    expect(diffRow).toHaveTextContent("assistant-updated");
    expect(screen.getByText(BADGE_TEXT)).toBeInTheDocument();

    // confirm(적용) → validate까지 반영된 결과 메시지.
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(await screen.findByText(/validate/)).toBeInTheDocument();
    expect(screen.getByText(BADGE_TEXT)).toBeInTheDocument();
  });
});
