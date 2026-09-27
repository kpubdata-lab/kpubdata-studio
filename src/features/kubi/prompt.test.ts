/**
 * Ask KPubData 프롬프트 조립 단위 테스트 (#256 review — Builder #504 contract: SQL은 logical relation
 * "dataset"만 조회해야 한다).
 */
import { describe, expect, it } from "vitest";
import { buildAsk KPubDataMessages } from "./prompt";
import type { Ask KPubDataEvidence } from "./types";

function baseEvidence(overrides: Partial<Ask KPubDataEvidence> = {}): Ask KPubDataEvidence {
  return {
    fetchedAt: "2026-08-14T00:00:00Z",
    context: { page: "dataset-detail", datasetId: "air-quality" },
    deepLinks: {},
    partial: false,
    unavailable: [],
    ...overrides,
  };
}

describe("buildAsk KPubDataMessages (#256 프롬프트)", () => {
  it("states the logical relation \"dataset\" rule in the system prompt's response contract", () => {
    const [systemMessage] = buildAsk KPubDataMessages("질문", baseEvidence());
    expect(systemMessage.role).toBe("system");
    expect(systemMessage.content).toContain('logical relation "dataset"');
    expect(systemMessage.content).toContain("source_key");
    expect(systemMessage.content).toContain("FROM dataset");
  });

  it("instructs that the real source_key must not be used as the SQL FROM table name", () => {
    const [systemMessage] = buildAsk KPubDataMessages("질문", baseEvidence());
    expect(systemMessage.content).toContain("FROM의 테이블명으로 쓰지 마세요");
    expect(systemMessage.content).toContain("generatedSql.source 필드로만 전달");
  });

  it("states the exact-column-name + TRY_CAST authoring invariants in the response contract", () => {
    const [systemMessage] = buildAsk KPubDataMessages("질문", baseEvidence());
    // 컬럼명 추측 금지 + schema evidence 참조
    expect(systemMessage.content).toContain("evidence.stage.schema");
    expect(systemMessage.content).toContain("evidence.stage.columns");
    expect(systemMessage.content).toContain("추측");
    // String 컬럼 numeric aggregation은 strict CAST가 아니라 TRY_CAST
    expect(systemMessage.content).toContain("TRY_CAST");
    // provider sentinel 때문에 전체 쿼리가 실패하지 않도록
    expect(systemMessage.content).toContain("sentinel");
    // 특정 데이터셋/컬럼에 하드코딩되어 있지 않다(AirKorea·pm10Value 전용 프롬프트 금지).
    expect(systemMessage.content).not.toContain("AirKorea");
    expect(systemMessage.content).not.toContain("pm10Value");
  });

  it("passes stage schema evidence through as untrusted structured content, not baked into the prompt text", () => {
    const evidence = baseEvidence({
      context: { page: "quality", datasetId: "air-quality", runId: "r1", stage: "gold", source: "datago__air_quality" },
      stage: {
        refId: "r1::datago__air_quality::gold",
        stage: "gold",
        source: "datago__air_quality",
        status: "completed",
        available: true,
        rowCount: 40,
        columns: ["stationName", "pm10Value"],
      },
    });
    const messages = buildAsk KPubDataMessages("측정소별 PM10 평균 SQL 만들어줘", evidence);
    // schema evidence는 structuredContent로만 전달되고 프롬프트 지시문에 문자열로 박히지 않는다.
    expect(messages[1].structuredContent).toEqual(evidence);
    expect(messages[0].content).not.toContain("pm10Value");
    expect(messages[1].content).not.toContain("pm10Value");
  });

  it("keeps evidence and user question isolated as separate untrusted-data messages", () => {
    const evidence = baseEvidence({
      stage: { refId: "r1::datago__air::silver", stage: "silver", source: "datago__air", status: "completed", available: true, rowCount: 10 },
    });
    const messages = buildAsk KPubDataMessages("서울 데이터 보여줘", evidence);
    expect(messages).toHaveLength(3);
    expect(messages[1].content).toContain("structured content");
    expect(messages[1].structuredContent).toEqual(evidence);
    expect(messages[1].content).not.toContain("datago__air");
    expect(messages[2].content).toContain("USER QUESTION START");
    expect(messages[2].content).toContain("서울 데이터 보여줘");
  });
});
