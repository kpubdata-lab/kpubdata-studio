/**
 * 어시스턴트 결정적 테스트 (ST-A9, #212).
 *
 * LLM 호출은 목으로 대체 — CI가 외부 LLM API에 의존하지 않는다.
 * 리페어 루프, 게이트 거부, 스크러빙을 고정된 응답 시퀀스로 검증한다.
 */
import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({ realBuilderEnabled: true }));

vi.mock("@/shared/lib/builderApi", () => ({
  isRealBuilderEnabled: () => mockState.realBuilderEnabled,
}));

import { generateBuildSpec } from "@/features/assistant/generate";
import type { GenerationOptions } from "@/features/assistant/generate";
import type { AssistProvider, AssistMessage } from "@/features/assistant/provider";
import { scrubSecrets, restoreSecrets, isSecretKey, looksLikeSecret } from "@/features/assistant/scrub";

const catalog = {
  providers: [
    {
      name: "datago",
      datasets: [
        {
          name: "village_fcst",
          title: "단기예보",
          description: null,
          tags: [],
          source_url: null,
          representation: "api_json" as const,
          operations: [],
          query_support: null,
          requires_service_key: true,
        },
      ],
    },
  ],
};

const validYaml = `dataset_id: test
title: Test
description: desc
sources:
  - key: s
    provider: datago
    dataset: village_fcst
exports:
  - kind: markdown
    output_path: out.md
`;

function mockProvider(responses: string[]): AssistProvider {
  let idx = 0;
  const provider = {
    isConfigured: true,
    exchange(messages: AssistMessage[]) {
      return {
        output: provider.stream(messages),
        displayOutput: provider.stream(messages),
        hadSecrets: false,
        restoreText: (text: string) => text,
      };
    },
    async *stream(_messages: AssistMessage[]): AsyncIterable<string> {
      const resp = responses[idx++] ?? responses[responses.length - 1];
      for (const char of resp) {
        yield char;
      }
    },
  } as unknown as AssistProvider;
  return provider;
}

describe("generateBuildSpec (ST-A7, #210)", () => {
  it("returns valid spec when validate passes on first try", async () => {
    const provider = mockProvider([validYaml]);
    const validateFn = vi.fn().mockResolvedValue({
      status: "valid",
      dataset_id: "test",
      api_version: "1.7.0",
    });

    const result = await generateBuildSpec(provider, "weather data", {
      validateFn,
      catalog,
    });

    expect(result.status).toBe("ok");
    expect(result.spec).toContain("dataset_id: test");
    expect(result.attempts).toBe(1);
    expect(validateFn).toHaveBeenCalledTimes(1);
  });

  it("retries when validate fails, succeeds on second attempt", async () => {
    const provider = mockProvider([validYaml, validYaml]);
    const validateFn = vi
      .fn()
      .mockResolvedValueOnce({ status: "invalid", problems: ["dataset_id is empty"] })
      .mockResolvedValueOnce({
        status: "valid",
        dataset_id: "test",
        api_version: "1.7.0",
      });

    const result = await generateBuildSpec(provider, "test", { catalog, validateFn });

    expect(result.status).toBe("ok");
    expect(result.attempts).toBe(2);
  });

  it("returns partial after max retries exhausted", async () => {
    const provider = mockProvider([validYaml, validYaml, validYaml]);
    const validateFn = vi
      .fn()
      .mockResolvedValue({ status: "invalid", problems: ["always fails"] });

    const result = await generateBuildSpec(provider, "test", { catalog, validateFn });

    expect(result.status).toBe("partial");
    expect(result.attempts).toBe(3);
    expect(result.remaining_problems).toContain("always fails");
  });

  it("rejects generation in mock mode", async () => {
    mockState.realBuilderEnabled = false;
    const provider = mockProvider(["should not be called"]);
    const result = await generateBuildSpec(provider, "test", {
      catalog,
      validateFn: vi.fn().mockResolvedValue({
        status: "valid",
        dataset_id: "test",
        api_version: "1.7.0",
      }),
    });
    mockState.realBuilderEnabled = true;

    expect(result.status).toBe("error");
    expect(result.spec).toBeNull();
    expect(result.remaining_problems[0]).toContain("mock");
  });

  it("검증을 통과한 구조화 출력의 요청별 시크릿을 복원한다", async () => {
    const placeholder = "__SCRUBBED_request-a_0__";
    const provider = {
      isConfigured: true,
      exchange: () => ({
        output: (async function* () {
          yield validYaml.replace(
            "    dataset: village_fcst",
            `    dataset: village_fcst\n    params:\n      serviceKey: ${placeholder}`,
          );
        })(),
        displayOutput: (async function* () {})(),
        hadSecrets: true,
        restoreText: (text: string) => text.replace(placeholder, "original-service-key"),
      }),
      stream: async function* () {},
    } as unknown as AssistProvider;

    const result = await generateBuildSpec(provider, "기존 스펙을 수정해줘", {
      catalog,
      validateFn: vi.fn().mockResolvedValue({
        status: "valid",
        dataset_id: "test",
        api_version: "1.7.0",
      }),
    });

    expect(result.status).toBe("ok");
    expect(result.spec).toContain("serviceKey: original-service-key");
    expect(result.spec).not.toContain("__SCRUBBED_");
  });

  it("알 수 없는 플레이스홀더가 남은 출력은 error로 처리한다", async () => {
    const provider = {
      isConfigured: true,
      exchange: () => ({
        output: (async function* () {
          yield validYaml.replace(
            "    dataset: village_fcst",
            "    dataset: village_fcst\n    params:\n      serviceKey: __SCRUBBED_another-request_0__",
          );
        })(),
        displayOutput: (async function* () {})(),
        hadSecrets: true,
        restoreText: () => {
          throw new Error("알 수 없는 시크릿 플레이스홀더가 포함되어 있습니다.");
        },
      }),
      stream: async function* () {},
    } as unknown as AssistProvider;

    const result = await generateBuildSpec(provider, "기존 스펙을 수정해줘", {
      catalog,
      validateFn: vi.fn().mockResolvedValue({
        status: "valid",
        dataset_id: "test",
        api_version: "1.7.0",
      }),
    });

    expect(result.status).toBe("error");
    expect(result.spec).toBeNull();
    expect(result.remaining_problems[0]).toContain("알 수 없는 시크릿");
  });

  it("카탈로그에 없는 provider는 repair 후 partial 처리한다", async () => {
    const unknownProvider = validYaml.replace("provider: datago", "provider: invented");
    const provider = mockProvider([unknownProvider, unknownProvider, unknownProvider]);
    const validateFn = vi.fn();

    const result = await generateBuildSpec(provider, "test", { catalog, validateFn });

    expect(result.status).toBe("partial");
    expect(result.remaining_problems[0]).toContain("카탈로그에 없는 provider");
    expect(validateFn).not.toHaveBeenCalled();
  });

  it("provider에 속하지 않은 dataset은 Builder 검증 전에 차단한다", async () => {
    const unknownDataset = validYaml.replace("dataset: village_fcst", "dataset: invented");
    const provider = mockProvider([unknownDataset, unknownDataset, unknownDataset]);
    const validateFn = vi.fn();

    const result = await generateBuildSpec(provider, "test", { catalog, validateFn });

    expect(result.status).toBe("partial");
    expect(result.remaining_problems[0]).toContain("provider 'datago'에 없는 소스 데이터셋");
    expect(validateFn).not.toHaveBeenCalled();
  });

  it("빈 카탈로그에서는 LLM을 호출하지 않고 fail-closed한다", async () => {
    const provider = mockProvider([validYaml]);
    const validateFn = vi.fn();

    const result = await generateBuildSpec(provider, "test", {
      catalog: { providers: [] },
      validateFn,
    });

    expect(result.status).toBe("error");
    expect(result.attempts).toBe(0);
    expect(result.remaining_problems[0]).toContain("카탈로그를 조회할 수 없어");
    expect(validateFn).not.toHaveBeenCalled();
  });

  it("Builder error는 repair problem으로 바꾸지 않고 즉시 error 처리한다", async () => {
    const provider = mockProvider([validYaml]);
    const result = await generateBuildSpec(provider, "test", {
      catalog,
      validateFn: vi.fn().mockResolvedValue({ status: "error", error: "service unavailable" }),
    });

    expect(result.status).toBe("error");
    expect(result.attempts).toBe(1);
    expect(result.remaining_problems).toEqual(["service unavailable"]);
  });

  it("validation transport 실패는 repair하지 않고 즉시 error 처리한다", async () => {
    const provider = mockProvider([validYaml, validYaml]);
    const result = await generateBuildSpec(provider, "test", {
      catalog,
      validateFn: vi.fn().mockRejectedValue(new Error("Engine API에 연결하지 못했습니다.")),
    });

    expect(result.status).toBe("error");
    expect(result.attempts).toBe(1);
    expect(result.remaining_problems[0]).toContain("연결하지 못했습니다");
  });

  it("런타임에서 validator가 누락되어도 ok를 반환하지 않는다", async () => {
    const callWithoutValidator = generateBuildSpec as unknown as (
      provider: AssistProvider,
      prompt: string,
      options: Partial<GenerationOptions>,
    ) => ReturnType<typeof generateBuildSpec>;

    const result = await callWithoutValidator(mockProvider([validYaml]), "test", { catalog });

    expect(result.status).toBe("error");
    expect(result.attempts).toBe(0);
    expect(result.remaining_problems[0]).toContain("/validate 연결이 없어");
  });

  it("validation에 AbortSignal을 전달한다", async () => {
    const provider = mockProvider([validYaml]);
    const controller = new AbortController();
    const validateFn = vi.fn().mockResolvedValue({
      status: "valid",
      dataset_id: "test",
      api_version: "1.7.0",
    });

    await generateBuildSpec(provider, "test", {
      catalog,
      validateFn,
      signal: controller.signal,
    });

    expect(validateFn).toHaveBeenCalledWith(validYaml.trim(), controller.signal);
  });
});

describe("scrubSecrets (ST-A3, #206)", () => {
  it("masks known secret key patterns", () => {
    const data = {
      serviceKey: "abc123secretkey",
      query: "station",
      apiKey: "sk-xxxxx",
      normal_param: "value",
    };
    const { scrubbed, placeholders } = scrubSecrets(data);
    const obj = scrubbed as Record<string, unknown>;

    expect(obj.serviceKey).toMatch(/__SCRUBBED_/);
    expect(obj.apiKey).toMatch(/__SCRUBBED_/);
    expect(obj.query).toBe("station");
    expect(obj.normal_param).toBe("value");
    expect(placeholders.size).toBe(2);
  });

  it("restores secrets after scrubbing", () => {
    const original = { serviceKey: "my-secret", name: "test" };
    const { scrubbed, placeholders } = scrubSecrets(original);
    const restored = restoreSecrets(scrubbed, placeholders) as Record<string, unknown>;

    expect(restored.serviceKey).toBe("my-secret");
    expect(restored.name).toBe("test");
  });

  it("detects high-entropy strings", () => {
    expect(looksLikeSecret("xJ7$kL9#mN2pQ4rT6vW8yB3cD5eF")).toBe(true);
    expect(looksLikeSecret("short")).toBe(false);
    expect(looksLikeSecret("normal description text")).toBe(false);
  });

  it("detects secret key names", () => {
    expect(isSecretKey("serviceKey")).toBe(true);
    expect(isSecretKey("api_key")).toBe(true);
    expect(isSecretKey("auth_token")).toBe(true);
    expect(isSecretKey("client_secret")).toBe(true);
    expect(isSecretKey("query")).toBe(false);
    expect(isSecretKey("base_date")).toBe(false);
  });
});
