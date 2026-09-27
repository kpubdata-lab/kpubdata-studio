/**
 * Result Preview 테이블 렌더링 regression test (#256 리뷰 §1).
 *
 * `/query` row에 array/object 값이 오면 실제 DOM에도 "[object Object]"가 아니라 JSON 내용이
 * 보여야 한다. `formatQueryValue`의 단위 테스트(`src/features/kubi/Ask KPubDataContent.test.tsx`)에
 * 더해, 실제 테이블 셀까지 이어지는 것을 확인한다.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistConfig } from "@/features/assistant/config";
import { createProvider } from "@/features/assistant/provider";
import { useAsk KPubDataStore } from "@/features/kubi/useAsk KPubDataSession";
import { Ask KPubDataPage } from "@/pages/Ask KPubDataPage";

vi.mock("@/features/assistant/provider", () => ({
  createProvider: vi.fn(),
}));

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

function mockQueryResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function configureKey() {
  act(() => {
    useAssistConfig.getState().setConfig({ apiKey: "sk-test-key", model: "gpt-4o-mini", baseUrl: "" });
  });
}

beforeEach(() => {
  useAsk KPubDataStore.setState({ turns: [], onboarded: false, pendingSeed: null });
  useAssistConfig.getState().clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Result Preview table — array/object values (#256 리뷰 §1)", () => {
  it("shows actual JSON content for array/object columns instead of [object Object]", async () => {
    // evidence 조회는 mock 데이터 경로를 그대로 타게 둔다(빠르고, evidence.ts는 별도 관심사) —
    // 이 테스트는 실행 버튼을 누른 뒤의 실제 Builder `/query` 호출만 real-builder 모드로 전환한다.
    configureKey();
    mockStream(() =>
      jsonText({
        answer: "Silver 데이터를 조회하는 쿼리입니다.",
        evidenceRefs: [],
        generatedSql: { sql: "SELECT * FROM dataset", stage: "silver" },
        suggestedActions: [],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/datasets/air-quality?run=air-2026-08-14&stage=silver"]}>
        <Ask KPubDataPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Ask KPubData 에 질문하기"), { target: { value: "SQL 만들어줘" } });
    fireEvent.submit(screen.getByLabelText("Ask KPubData 에 질문하기").closest("form")!);
    // ask()는 fire-and-forget(submit 핸들러가 await하지 않는다) — 실행 버튼이 뜰 때까지 기다린다.
    const runButton = await screen.findByRole("button", { name: "실행" });

    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockQueryResponse(200, {
          columns: ["region", "tags", "meta"],
          rows: [{ region: "서울", tags: ["대기질", "미세먼지"], meta: { ok: true, count: 3 } }],
          truncated: false,
          execution_ms: 5,
        }),
      ),
    );

    fireEvent.click(runButton);
    await screen.findByText(JSON.stringify(["대기질", "미세먼지"]));

    expect(screen.getByText(JSON.stringify(["대기질", "미세먼지"]))).toBeInTheDocument();
    expect(screen.getByText(JSON.stringify({ ok: true, count: 3 }))).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });
});
