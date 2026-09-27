/**
/**
 * Column meaning decoding — augment dataset card (AI-1, #228).
 *
 * Korean public data column names (MTHDT, BSNS_LCNS_NM, DTLBDT_SE, etc.) look like abbreviations/ciphers;
 * hard to parse meaning. LLM seeing column name with sample rows (actual values) can generate
 * "oh, monthly date and business license name" style descriptions. These functions manage prompt
 * composition and generation requests.
 */
import type { AssistProvider, AssistMessage } from "./provider";

/** Column description draft result. */
export interface ColumnMeaningResult {
  descriptions: Record<string, string>;
  status: "ok" | "error";
  scrubbed: boolean;
}

/** Column metadata (subset of PreviewColumn). */
export interface ColumnMeta {
  name: string;
  dtype: string;
}

/**
 * Compose LLM prompt from column list and sample rows (#228).
 *
 * Sample rows not pre-serialized to string; kept as structured content.
 * Common provider egress does key-aware scrubbing, then creates final payload.
 */
export function buildColumnMeaningPrompt(
  columns: ColumnMeta[],
  sampleRows: Record<string, unknown>[],
): { messages: AssistMessage[] } {
  const colList = columns
    .map((c) => `  - ${c.name} (${c.dtype})`)
    .join("\n");

  const systemPrompt = `당신은 한국 공공데이터 컬럼명 해독 전문가입니다.
각 컬럼의 이름, dtype, 샘플 값을 근거로 한국어 설명을 작성하세요.
출력 형식: JSON 객체, 키는 컬럼명, 값은 한국어 설명 (1~2문장).
시크릿 값은 마스킹되어 있으니 그대로 두세요.`;

  const userPrompt = `컬럼 목록:
${colList}

샘플 데이터는 첨부된 구조화 컨텍스트를 참고하세요.

각 컬럼에 대한 한국어 설명을 JSON으로 출력하세요.`;

  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt, structuredContent: sampleRows.slice(0, 5) },
    ],
  };
}

/**
 * Generate column description draft via LLM (#228).
 *
 * @param provider LLM provider (BYOK).
 * @param columns Column metadata.
 * @param sampleRows Sample rows (scrubbed by common provider egress before LLM transmission).
 * @param signal Abort signal.
 * @returns Column name → Korean description mapping. status="error" if LLM not configured.
 */
export async function generateColumnMeanings(
  provider: AssistProvider,
  columns: ColumnMeta[],
  sampleRows: Record<string, unknown>[],
  signal?: AbortSignal,
): Promise<ColumnMeaningResult> {
  const { messages } = buildColumnMeaningPrompt(columns, sampleRows);

  const exchange = provider.exchange(messages, signal);
  let rawOutput = "";
  for await (const chunk of exchange.displayOutput) {
    rawOutput += chunk;
  }

  // JSON extraction (```json block or direct JSON).
  const jsonMatch =
    rawOutput.match(/```json\n([\s\S]*?)\n```/) ?? rawOutput.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : rawOutput.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, string>;
    return { descriptions: parsed, status: "ok", scrubbed: exchange.hadSecrets };
  } catch {
    return { descriptions: {}, status: "error", scrubbed: exchange.hadSecrets };
  }
}
