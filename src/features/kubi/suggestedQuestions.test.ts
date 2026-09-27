/**
 * 추천 질문 선택 로직 회귀 (#S-kubi-suggest).
 *
 * - context가 없으면 Quality/Build 실패/SQL 질문을 강제로 노출하지 않는다.
 * - Dataset/Run/Quality context가 실제로 있을 때만 그에 맞는 질문을 노출한다.
 * - 최근 답변 turn이 있으면 그 구조화 단서로 follow-up을 바꾼다(LLM 재호출 없음).
 */
import { describe, expect, it } from "vitest";
import { START_QUESTIONS, getSuggestedQuestions } from "./suggestedQuestions";
import type { KubiContext, KubiEvidence, KubiTurn } from "./types";

/** 필수 필드만 채운 최소 evidence(테스트가 지정한 조각을 덮어쓴다). */
function evidence(partial: Partial<KubiEvidence>): KubiEvidence {
  return {
    fetchedAt: "2026-09-02T00:00:00Z",
    context: { page: "kubi" },
    deepLinks: {},
    partial: false,
    unavailable: [],
    ...partial,
  };
}

function turn(overrides: Partial<KubiTurn>): KubiTurn {
  return {
    id: "t1",
    question: "q",
    context: { page: "kubi" },
    createdAt: "2026-09-02T00:00:00Z",
    status: "ok",
    query: { status: "idle" },
    actionStates: {},
    response: { answer: "a", evidenceRefs: [], generatedSql: null, suggestedActions: [] },
    ...overrides,
  };
}

const ask = (context: KubiContext, turns: KubiTurn[] = []) =>
  getSuggestedQuestions({ context, turns });

describe("getSuggestedQuestions — context별 초기 추천", () => {
  it("A. Dataset/Run/Quality가 없으면 시작 질문만 노출한다", () => {
    const result = ask({ page: "kubi" });
    expect(result).toEqual(START_QUESTIONS);
    const joined = result.join(" ");
    expect(joined).not.toMatch(/Quality/);
    expect(joined).not.toMatch(/실패/);
    expect(joined).not.toMatch(/SQL/);
  });

  it("home context도 시작 질문을 준다", () => {
    expect(ask({ page: "home" })).toEqual(START_QUESTIONS);
  });

  it("B. Dataset context가 있으면 Dataset 질문을 노출한다", () => {
    const result = ask({ page: "dataset-detail", datasetId: "ds-1" });
    expect(result.some((q) => q.includes("데이터셋의 구조"))).toBe(true);
    expect(result).not.toEqual(START_QUESTIONS);
  });

  it("C. Run context가 있으면 Run 질문을 노출한다", () => {
    const result = ask({ page: "build-detail", runId: "run-1" });
    expect(result.some((q) => q.includes("Run 결과를 요약"))).toBe(true);
  });

  it("C. Run이 없으면 실패/경고 단계 질문을 강제로 넣지 않는다", () => {
    const result = ask({ page: "kubi" });
    expect(result.some((q) => q.includes("실패한 단계"))).toBe(false);
  });

  it("D. Quality page라도 run/dataset이 없으면 Quality-specific을 넣지 않는다", () => {
    expect(ask({ page: "quality" })).toEqual(START_QUESTIONS);
  });

  it("D. Quality page + run이 있으면 Quality 질문을 노출한다", () => {
    const result = ask({ page: "quality", runId: "run-1" });
    expect(result.some((q) => q.includes("Quality 이슈의 원인"))).toBe(true);
  });

  it("silver/gold stage면 컬럼/SQL 질문을 노출한다", () => {
    const result = ask({ page: "build-detail", runId: "run-1", stage: "gold" });
    expect(result.some((q) => q.includes("컬럼"))).toBe(true);
    expect(result.some((q) => q.includes("SQL"))).toBe(true);
  });

  it("최대 4개, 중복 없음", () => {
    const result = ask({ page: "kubi" });
    expect(result.length).toBeLessThanOrEqual(4);
    expect(new Set(result).size).toBe(result.length);
  });
});

describe("getSuggestedQuestions — 최근 대화 기반 follow-up", () => {
  it("첫 turn 전 추천과 answered turn 후 추천이 달라진다", () => {
    const context: KubiContext = { page: "kubi" };
    const before = ask(context);
    const after = getSuggestedQuestions({
      context,
      turns: [turn({ evidence: evidence({ catalog: { providers: ["datago"], datasetsByProvider: {} } }) })],
    });
    expect(after).not.toEqual(before);
    expect(after.some((q) => q.includes("Add Data로 가져오는"))).toBe(true);
  });

  it("generatedSql이 있으면 SQL 해석 follow-up을 준다", () => {
    const after = getSuggestedQuestions({
      context: { page: "kubi", runId: "run-1", stage: "gold" },
      turns: [
        turn({
          response: {
            answer: "a",
            evidenceRefs: [],
            generatedSql: { sql: "SELECT 1", stage: "gold" },
            suggestedActions: [],
          },
        }),
      ],
    });
    expect(after.some((q) => q.includes("SQL 결과를 어떻게 해석"))).toBe(true);
  });

  it("quality 이슈가 있는 turn 뒤에는 우선순위 follow-up을 준다", () => {
    const after = getSuggestedQuestions({
      context: { page: "quality", runId: "run-1" },
      turns: [
        turn({
          evidence: evidence({
            quality: {
              availability: "available",
              evaluatedChecks: 3,
              results: [
                { id: "r1", source: "s", category: "c", rule: "x", column: null, status: "fail", actual: 1, threshold: 0, detail: null },
              ],
              schemaDrift: [],
            },
          }),
        }),
      ],
    });
    expect(after.some((q) => q.includes("먼저 고쳐야 할 품질 문제"))).toBe(true);
  });

  it("stale한 최근 turn은 follow-up 근거로 쓰지 않는다(초기 추천으로 fallback)", () => {
    const result = getSuggestedQuestions({
      context: { page: "kubi" },
      turns: [turn({ evidence: evidence({ catalog: { providers: ["datago"], datasetsByProvider: {} } }) })],
      isStale: () => true,
    });
    expect(result).toEqual(START_QUESTIONS);
  });

  it("구조화 단서가 없는 turn 뒤에는 generic follow-up으로 fallback한다", () => {
    const after = getSuggestedQuestions({
      context: { page: "dataset-detail", datasetId: "ds-1" },
      turns: [turn({ evidence: undefined })],
    });
    expect(after.some((q) => q.includes("자세히 설명"))).toBe(true);
  });
});
