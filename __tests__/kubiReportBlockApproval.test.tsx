/**
 * ADD_REPORT_BLOCK 승인 미리보기 테스트 (#256 리뷰 §3).
 *
 * action card가 reason만 보여주는 게 아니라, 실제로 큐에 들어갈 note 문장과 연결된 evidence를
 * 승인 전에 미리 볼 수 있는지, 그리고 queue/handoff가 승인 이후에만 일어나는지 확인한다.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistConfig } from "@/features/assistant/config";
import { createProvider } from "@/features/assistant/provider";
import { useAsk KPubDataStore } from "@/features/kubi/useAsk KPubDataSession";
import { listAsk KPubDataReportNotes } from "@/features/kubi/reportInbox";
import { Ask KPubDataPage } from "@/pages/Ask KPubDataPage";

vi.mock("@/features/assistant/provider", () => ({
  createProvider: vi.fn(),
}));

const NOTE = "가격 결측이 특정 지역에 집중됩니다.";

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

beforeEach(() => {
  useAsk KPubDataStore.setState({ turns: [], onboarded: false, pendingSeed: null });
  useAssistConfig.getState().clear();
  localStorage.removeItem("kpubdata-studio:kubi-report-inbox");
});

afterEach(() => {
  localStorage.clear();
});

async function askForReportBlock() {
  configureKey();
  mockStream(() =>
    jsonText({
      answer: "가격 결측 패턴을 확인했습니다.",
      evidenceRefs: [{ kind: "dataset", id: "air-quality", label: "대기질 통합 데이터" }],
      generatedSql: null,
      suggestedActions: [{ type: "ADD_REPORT_BLOCK", note: NOTE, reason: "품질 이슈 참고용" }],
    }),
  );
  render(
    <MemoryRouter initialEntries={["/datasets/air-quality?run=air-2026-08-14"]}>
      <Ask KPubDataPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Ask KPubData 에 질문하기"), { target: { value: "가격 결측 요약해줘" } });
  fireEvent.submit(screen.getByLabelText("Ask KPubData 에 질문하기").closest("form")!);
  // ask()는 fire-and-forget(submit 핸들러가 await하지 않는다) — 승인 버튼이 뜰 때까지 기다린다.
  await screen.findByRole("button", { name: "승인" });
}

describe("ADD_REPORT_BLOCK approval preview (#256 리뷰 §3)", () => {
  it("shows the exact note text and linked evidence before approval, and queues nothing yet", async () => {
    await askForReportBlock();

    expect(screen.getByText(NOTE)).toBeInTheDocument();
    // "대기질 통합 데이터"는 turn 전체 Evidence 목록과 ADD_REPORT_BLOCK 미리보기 양쪽에 나타날 수 있다 —
    // 적어도 action card 미리보기 안에는 반드시 있어야 한다.
    expect(screen.getAllByText("대기질 통합 데이터").length).toBeGreaterThan(0);
    expect(listAsk KPubDataReportNotes()).toHaveLength(0);
  });

  it("only queues the note into the Reports inbox after the user clicks 승인 (not before)", async () => {
    await askForReportBlock();
    expect(listAsk KPubDataReportNotes()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "승인" }));
    await screen.findByText("Report 참고 노트로 추가했습니다.");

    const notes = listAsk KPubDataReportNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe(NOTE);
    // 승인 후에도 미리보기 텍스트는 그대로 남아있어 사용자가 무엇을 승인했는지 확인할 수 있다.
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it("queues nothing when the user rejects instead of approving", async () => {
    await askForReportBlock();

    fireEvent.click(screen.getByRole("button", { name: "거부" }));
    await screen.findByText("거부됨");

    expect(listAsk KPubDataReportNotes()).toHaveLength(0);
  });
});
