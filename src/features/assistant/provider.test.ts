import { afterEach, describe, expect, it, vi } from "vitest";

import { SYSTEM_PROMPT } from "./prompt";
import { createProvider, describeLlmHttpError } from "./provider";

const SENSITIVE_BODY = JSON.stringify({
  error: {
    message:
      "Incorrect API key provided: sk-live-secret-abc123. Internal trace: srv-7f2a at /var/app/openai/handler.js:42",
  },
});

function mockErrorResponse(status: number): Response {
  return { ok: false, status, body: null } as unknown as Response;
}

async function drain(iterable: AsyncIterable<string>): Promise<string> {
  let output = "";
  for await (const chunk of iterable) output += chunk;
  return output;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("describeLlmHttpError (#256)", () => {
  it("HTTP status만 사용한 고정 메시지를 반환한다", () => {
    expect(describeLlmHttpError(401)).toMatch(/API Key/);
    expect(describeLlmHttpError(403)).toMatch(/API Key/);
    expect(describeLlmHttpError(429)).toMatch(/rate limit|한도/);
    expect(describeLlmHttpError(500)).toMatch(/서버/);
    expect(describeLlmHttpError(503)).toMatch(/서버/);
  });

  it("임의의 response text를 포함하지 않는다", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 502, 503]) {
      expect(describeLlmHttpError(status)).not.toContain("sk-live-secret-abc123");
      expect(describeLlmHttpError(status)).not.toContain("Internal trace");
    }
  });
});

describe("assistant provider error sanitization (#256)", () => {
  it.each([
    [401, /API Key/],
    [429, /rate limit|한도/],
    [500, /서버/],
  ])("%i 응답의 raw body를 노출하지 않는다", async (status, expected) => {
    const text = vi.fn(async () => SENSITIVE_BODY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ...mockErrorResponse(status), text }),
    );
    const provider = createProvider({
      apiKey: "sk-live-secret-abc123",
      model: "gpt-4o-mini",
      baseUrl: "",
    });

    await expect(drain(provider.stream([]))).rejects.toThrow(expected);
    await expect(drain(provider.stream([]))).rejects.not.toThrow("sk-live-secret-abc123");
    expect(text).not.toHaveBeenCalled();
  });

  it("network error에 반사된 API key를 제거한다", async () => {
    const apiKey = "sk-live-secret-abc123";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError(`failed to reach host with key ${apiKey}`)),
    );
    const provider = createProvider({ apiKey, model: "gpt-4o-mini", baseUrl: "" });

    let caught: unknown;
    try {
      await drain(provider.stream([]));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(apiKey);
  });
});

describe("assistant safe egress (#273)", () => {
  it("최종 HTTP body에서 text와 structured content의 시크릿을 제거한다", async () => {
    const textSecret = "xJ7kL9mN2pQ4rT6vW8yB3cD5eF7gH9j";
    const structuredSecret = "low-entropy-key";
    let requestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = String(init?.body);
        return new Response(
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        );
      }),
    );

    const provider = createProvider({
      apiKey: "byok-key",
      model: "test-model",
      baseUrl: "https://llm.example.com/v1",
    });
    const output = await drain(
      provider.stream([
        { role: "user", content: `분석 ${textSecret}` },
        {
          role: "system",
          content: "현재 스펙",
          structuredContent: { sources: [{ params: { serviceKey: structuredSecret } }] },
        },
      ]),
    );

    expect(output).toBe("ok");
    expect(requestBody).not.toContain(textSecret);
    expect(requestBody).not.toContain(structuredSecret);
    expect(requestBody).toContain("__SCRUBBED_");
  });

  it("safeRunIds 옵션: 확인된 run id 는 egress 에 보존하고 인접 시크릿은 스크럽한다", async () => {
    const runId = "datago-air-quality-1788004513062";
    const adjacentSecret = "xJ7kL9mN2pQ4rT6vW8yB3cD5eF7gH9j";
    let requestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = String(init?.body);
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
        });
      }),
    );

    const provider = createProvider({
      apiKey: "byok-key",
      model: "test-model",
      baseUrl: "https://llm.example.com/v1",
    });
    const output = await drain(
      provider.stream(
        [{ role: "user", content: `run ${runId} 그리고 ${adjacentSecret}/${runId} 확인` }],
        undefined,
        { safeRunIds: new Set([runId]) },
      ),
    );

    expect(output).toBe("ok");
    expect(requestBody).toContain(runId);
    expect(requestBody).not.toContain(adjacentSecret);
    expect(requestBody).toContain("__SCRUBBED_");
  });

  it("safeRunIds 옵션 없이는 run-id 처럼 생긴 고엔트로피 값도 egress 에서 스크럽한다", async () => {
    const runId = "datago-air-quality-1788004513062";
    let requestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = String(init?.body);
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
        });
      }),
    );

    const provider = createProvider({
      apiKey: "byok-key",
      model: "test-model",
      baseUrl: "https://llm.example.com/v1",
    });
    await drain(provider.stream([{ role: "user", content: `run ${runId} 확인` }]));

    expect(requestBody).not.toContain(runId);
    expect(requestBody).toContain("__SCRUBBED_");
  });

  it("일반 응답에는 시크릿이나 플레이스홀더를 노출하지 않는다", async () => {
    const secret = "low-entropy-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"__SCRUB"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"BED_fake_0__"}}]}\n\n',
          { status: 200 },
        ),
      ),
    );

    const provider = createProvider({
      apiKey: "byok-key",
      model: "test-model",
      baseUrl: "https://llm.example.com/v1",
    });
    const output = await drain(
      provider.stream([
        { role: "user", content: "분석", structuredContent: { serviceKey: secret } },
      ]),
    );

    expect(output).toBe("[REDACTED]");
    expect(output).not.toContain(secret);
  });
});

describe("assistant fixed system prompt egress (#934)", () => {
  // A long mixed-case token that the scrubber treats as high-entropy, assembled at run time
  // so no key-shaped literal sits in the source.
  function oddToken(seed: string): string {
    return ["xJ7k", "L9mN", "2pQ4", "rT6v", "W8yB", "3cD5", "eF7g", "H9j"].map((part) => part + seed).join("");
  }

  function captureBody(): { body: () => string } {
    let requestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = String(init?.body);
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
      }),
    );
    return { body: () => requestBody };
  }

  it("sends the fixed system prompt intact, with its allowed kind and action lists readable", async () => {
    const captured = captureBody();
    const provider = createProvider({ apiKey: "byok-key", model: "m", baseUrl: "" });
    await drain(provider.stream([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "question?" }]));
    const sent = JSON.parse(captured.body()) as { messages: { role: string; content: string }[] };
    expect(sent.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(sent.messages[0].content).not.toContain("__SCRUBBED_");
    expect(sent.messages[0].content).toContain("dataset|run|stage|quality|schema_drift|catalog");
  });

  it("still scrubs a secret-like value in the question and in evidence next to the intact prompt", async () => {
    const questionToken = oddToken("q");
    const evidenceToken = oddToken("e");
    const captured = captureBody();
    const provider = createProvider({ apiKey: "byok-key", model: "m", baseUrl: "" });
    await drain(
      provider.stream([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: "evidence", structuredContent: { note: evidenceToken } },
        { role: "user", content: `check ${questionToken}` },
      ]),
    );
    const body = captured.body();
    expect(body).not.toContain(questionToken);
    expect(body).not.toContain(evidenceToken);
    expect(body).toContain("dataset|run|stage|quality|schema_drift|catalog");
  });

  it("does not exempt other system text: only the constant itself is exempt", async () => {
    const appended = oddToken("a");
    const captured = captureBody();
    const provider = createProvider({ apiKey: "byok-key", model: "m", baseUrl: "" });
    await drain(provider.stream([{ role: "system", content: `${SYSTEM_PROMPT}\n${appended}` }]));
    expect(captured.body()).not.toContain(appended);
  });

  it("regression: scrubbing the prompt as ordinary text mangles the contract lists", async () => {
    const { createSecretScrubber } = await import("./scrub");
    const mangled = createSecretScrubber().scrubText(SYSTEM_PROMPT);
    expect(mangled).toContain("__SCRUBBED_");
    expect(mangled).not.toContain("dataset|run|stage|quality|schema_drift|catalog");
  });
});
