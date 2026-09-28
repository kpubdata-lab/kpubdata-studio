/**
 * Unit tests for Ask KPubData prompt assembly (#256 review — Builder #504 contract: SQL must query
 * the logical relation "dataset" only).
 */
import { describe, expect, it } from "vitest";
import { buildAssistantMessages } from "./prompt";
import type { AssistantEvidence } from "./types";

function baseEvidence(overrides: Partial<AssistantEvidence> = {}): AssistantEvidence {
  return {
    fetchedAt: "2026-08-14T00:00:00Z",
    context: { page: "dataset-detail", datasetId: "air-quality" },
    deepLinks: {},
    partial: false,
    unavailable: [],
    ...overrides,
  };
}

describe("buildAssistantMessages (#256 프롬프트)", () => {
  it("states the logical relation \"dataset\" rule in the system prompt's response contract", () => {
    const [systemMessage] = buildAssistantMessages("질문", baseEvidence());
    expect(systemMessage.role).toBe("system");
    expect(systemMessage.content).toContain('logical relation "dataset"');
    expect(systemMessage.content).toContain("source_key");
    expect(systemMessage.content).toContain("FROM dataset");
  });

  it("instructs that the real source_key must not be used as the SQL FROM table name", () => {
    const [systemMessage] = buildAssistantMessages("질문", baseEvidence());
    expect(systemMessage.content).toContain("FROM의 테이블명으로 쓰지 마세요");
    expect(systemMessage.content).toContain("generatedSql.source 필드로만 전달");
  });

  it("states the exact-column-name + TRY_CAST authoring invariants in the response contract", () => {
    const [systemMessage] = buildAssistantMessages("질문", baseEvidence());
    // Disallow guessing column names; refer to schema evidence.
    expect(systemMessage.content).toContain("evidence.stage.schema");
    expect(systemMessage.content).toContain("evidence.stage.columns");
    expect(systemMessage.content).toContain("추측");
    // For numeric aggregations on string columns use TRY_CAST, not strict CAST.
    expect(systemMessage.content).toContain("TRY_CAST");
    // Use a provider sentinel so the entire query won't fail due to provider issues.
    expect(systemMessage.content).toContain("sentinel");
    // Do not hardcode prompts for specific datasets/columns (e.g., no AirKorea or pm10Value).
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
    const messages = buildAssistantMessages("측정소별 PM10 평균 SQL 만들어줘", evidence);
    // Stage schema evidence is passed as structuredContent only and must not be embedded
  // verbatim into the prompt text.
    expect(messages[1].structuredContent).toEqual(evidence);
    expect(messages[0].content).not.toContain("pm10Value");
    expect(messages[1].content).not.toContain("pm10Value");
  });

  it("keeps evidence and user question isolated as separate untrusted-data messages", () => {
    const evidence = baseEvidence({
      stage: { refId: "r1::datago__air::silver", stage: "silver", source: "datago__air", status: "completed", available: true, rowCount: 10 },
    });
    const messages = buildAssistantMessages("서울 데이터 보여줘", evidence);
    expect(messages).toHaveLength(3);
    expect(messages[1].content).toContain("structured content");
    expect(messages[1].structuredContent).toEqual(evidence);
    expect(messages[1].content).not.toContain("datago__air");
    expect(messages[2].content).toContain("USER QUESTION START");
    expect(messages[2].content).toContain("서울 데이터 보여줘");
  });
});
