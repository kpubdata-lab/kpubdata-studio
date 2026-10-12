/**
 * A deployment that keeps Ask KPubData off sends nothing to an AI provider (#798).
 *
 * The real session hook, evidence loader and provider run; only `fetch` is wrapped, so
 * every request the page makes is seen. The question, the API key and a table id carry
 * canary values, and the checks are on the wire: no request goes to the AI host, and no
 * request anywhere carries a canary. The control case turns the assistant on with the
 * host allowed and sees the request go out, so a wrapper that saw nothing would not pass.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistConfig } from "@/features/assistant/config";
import { createProvider } from "@/features/assistant/provider";
import { useAssistantSession, useAssistantStore } from "@/features/assistant/useAssistantSession";
import type { RuntimeConfig } from "@/shared/config/runtime";

const AI_ORIGIN = "https://api.openai.com";
const KEY_CANARY = "sk-canary-canary";
// Short words, so the scrubber leaves the question as it is and the control can find it.
const QUESTION_CANARY = "canary 7731 hong@example.org pm10";

let calls: { url: string; body: string; headers: string }[] = [];

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/tables/apt-trade"]}>{children}</MemoryRouter>;
}

function deploy(config: RuntimeConfig) {
  window.__KPUBDATA_CONFIG__ = config;
  act(() => useAssistConfig.getState().setConfig({ apiKey: KEY_CANARY, model: "m", baseUrl: "" }));
}

async function ask() {
  const { result } = renderHook(() => useAssistantSession(), { wrapper });
  await act(async () => {
    await result.current.ask(QUESTION_CANARY);
  });
  return useAssistantStore.getState().turns.at(-1);
}

const toAiHost = () => calls.filter((call) => call.url.startsWith(AI_ORIGIN));

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
  useAssistantStore.setState({ turns: [], onboarded: false, pendingSeed: null });
  calls = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, body: String(init?.body ?? ""), headers: JSON.stringify(init?.headers ?? {}) });
    if (url.startsWith(AI_ORIGIN)) return new Response("data: [DONE]\n\n", { status: 200 });
    return realFetch(input, init);
  });
});

afterEach(() => {
  delete window.__KPUBDATA_CONFIG__;
  useAssistConfig.getState().clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Ask KPubData in a deployment that keeps it off (#798)", () => {
  it("sends no request to the AI host, and no canary anywhere, when a question is asked", async () => {
    deploy({ assistantEnabled: "false" });
    const turn = await ask();

    expect(turn?.status).toBe("error");
    expect(toAiHost()).toEqual([]);
    for (const call of calls) {
      for (const canary of [KEY_CANARY, QUESTION_CANARY]) expect(JSON.stringify(call)).not.toContain(canary);
    }
  });

  it("refuses at the provider too, for a caller that skips the session", async () => {
    deploy({ assistantEnabled: "false" });
    const provider = createProvider({ apiKey: KEY_CANARY, model: "m", baseUrl: "" });
    await expect(
      (async () => {
        for await (const _chunk of provider.stream([{ role: "user", content: QUESTION_CANARY }])) {
          // nothing arrives
        }
      })(),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("sends nothing to an address the deployment did not allow", async () => {
    deploy({ assistantEnabled: "true", assistantAllowedOrigins: "https://llm.example.org" });
    const turn = await ask();

    expect(turn?.error?.kind).toBe("bad_base_url");
    expect(toAiHost()).toEqual([]);
  });

  it("sends the question to the allowed host once it is turned on (the control)", async () => {
    deploy({ assistantEnabled: "true", assistantAllowedOrigins: AI_ORIGIN });
    await ask();

    expect(toAiHost()).toHaveLength(1);
    expect(toAiHost()[0].url).toBe(`${AI_ORIGIN}/v1/chat/completions`);
    expect(toAiHost()[0].body).toContain(QUESTION_CANARY);
  });
});
