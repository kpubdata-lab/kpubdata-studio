/**
 * Ask KPubData "관련 데이터셋" 사이드 패널 (#256 이슈 체크리스트 — "관련 데이터셋 후보는 실제 `/catalog`
 * evidence와 대조").
 *
 * 순수 함수 로직은 `src/features/kubi/relatedDatasets.test.ts`가 담당한다. 여기서는 실제
 * evidence 로딩(`loadAsk KPubDataEvidence` → Builder `/catalog`)부터 `Ask KPubDataContent`의 non-compact
 * 사이드 패널 렌더링까지 전체 배선이 맞는지 확인한다 — 프로토타입의 하드코딩된 "관련 데이터셋"
 * 목록과 달리, 실제로 존재하지 않는 provider/dataset을 만들어내지 않아야 한다.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistConfig } from "@/features/assistant/config";
import { createProvider } from "@/features/assistant/provider";
import { useAsk KPubDataStore } from "@/features/kubi/useAsk KPubDataSession";
import { Ask KPubDataPage } from "@/pages/Ask KPubDataPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

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

function configureKeyAndAsk() {
  act(() => {
    useAssistConfig.getState().setConfig({ apiKey: "sk-test-key", model: "gpt-4o-mini", baseUrl: "" });
  });
  mockStream(() =>
    jsonText({
      answer: "현재 데이터셋 상태를 요약했습니다.",
      evidenceRefs: [{ kind: "dataset", id: "air-quality", label: "대기질 통합 데이터" }],
      generatedSql: null,
      suggestedActions: [],
    }),
  );
}

async function askAbout(datasetId: string) {
  render(
    <MemoryRouter initialEntries={[`/kubi?dataset=${datasetId}`]}>
      <Ask KPubDataPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Ask KPubData 에 질문하기"), { target: { value: "이 데이터셋 상태 알려줘" } });
  fireEvent.submit(screen.getByLabelText("Ask KPubData 에 질문하기").closest("form")!);
  await screen.findByText("현재 데이터셋 상태를 요약했습니다.");
}

beforeEach(() => {
  useAsk KPubDataStore.setState({ turns: [], onboarded: false, pendingSeed: null });
  useAssistConfig.getState().clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("Ask KPubData 관련 데이터셋 패널 (#256 이슈 체크리스트)", () => {
  it("shows a plain explanation instead of guessing when the dataset's provider has no catalog overlap", async () => {
    // 전역 MSW catalog fixture는 provider "datago"만 제공하고, air-quality mock dataset의
    // provider("data.go.kr"/"kma")와 이름이 겹치지 않는다 — 이 경우 후보를 지어내지 않는다.
    configureKeyAndAsk();
    await askAbout("air-quality");

    expect(screen.getByText("관련 데이터셋")).toBeInTheDocument();
    expect(
      screen.getByText("질문을 보내 evidence를 불러오면 같은 provider의 다른 데이터셋 후보를 확인할 수 있습니다."),
    ).toBeInTheDocument();
  });

  it("lists sibling catalog datasets from the same provider, grounded in the real /catalog response", async () => {
    mswServer.use(
      http.get(`${API_BASE}/catalog`, () =>
        HttpResponse.json({
          providers: [
            {
              name: "data.go.kr",
              datasets: [
                {
                  name: "air",
                  title: "대기질 원본",
                  description: null,
                  tags: [],
                  source_url: null,
                  representation: "api_json",
                  operations: [],
                  query_support: null,
                  requires_service_key: true,
                },
                {
                  name: "traffic_accident",
                  title: "교통사고 통계",
                  description: null,
                  tags: [],
                  source_url: null,
                  representation: "api_json",
                  operations: [],
                  query_support: null,
                  requires_service_key: false,
                },
              ],
            },
          ],
        }),
      ),
    );

    configureKeyAndAsk();
    await askAbout("air-quality");

    expect(screen.getByText("관련 데이터셋")).toBeInTheDocument();
    // air-quality 자신의 source("air")는 후보에서 제외되고, 같은 provider의 다른 catalog
    // dataset("traffic_accident")만 실제 evidence 기반으로 나타난다.
    expect(screen.getByText("traffic_accident")).toBeInTheDocument();
    expect(screen.queryByText(/질문을 보내 evidence를 불러오면/)).not.toBeInTheDocument();
  });
});
