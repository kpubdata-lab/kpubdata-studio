/**
 * Provider keys held for this page load (#652, kpubdata-builder#683, contract 1.56.0).
 *
 * Verifies the header form Builder parses (`<provider>=<key>`, comma-separated), that a
 * key never reaches browser storage or a URL, and that exactly the provider-calling routes
 * and the provider list (which reports what the held keys cover) carry it — and only
 * while a key is held, so a single-user deployment sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builderApi } from "./builderApi";
import {
  PROVIDER_KEY_HEADER,
  forgetAllProviderKeys,
  forgetProviderKey,
  holdProviderKey,
  isProviderKeyHeld,
  providerKeyHeaders,
  providerKeyProblem,
} from "./providerKeys";

const KEY = "dg-KEY-value+/abc==";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  forgetAllProviderKeys();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("providerKeys memory store", () => {
  it("builds the X-Provider-Key header Builder parses, one item per held provider", () => {
    expect(providerKeyHeaders()).toEqual({});
    expect(holdProviderKey("DataGo", `  ${KEY}  `)).toBe(true);
    expect(holdProviderKey("kosis", "k2")).toBe(true);
    expect(providerKeyHeaders()).toEqual({ [PROVIDER_KEY_HEADER]: `datago=${KEY},kosis=k2` });
    expect(isProviderKeyHeld("datago")).toBe(true);

    forgetProviderKey("datago");
    expect(isProviderKeyHeld("datago")).toBe(false);
    expect(providerKeyHeaders()).toEqual({ [PROVIDER_KEY_HEADER]: "kosis=k2" });
  });

  it("refuses a key the comma-separated header would split or corrupt", () => {
    expect(providerKeyProblem("   ")).toBe("empty");
    expect(providerKeyProblem("a,b")).toBe("unsupported_character");
    expect(providerKeyProblem("a\nb")).toBe("unsupported_character");
    expect(providerKeyProblem("키값")).toBe("unsupported_character");
    expect(holdProviderKey("datago", "a,b")).toBe(false);
    expect(providerKeyHeaders()).toEqual({});
  });

  it("never writes a key to localStorage or sessionStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    holdProviderKey("datago", KEY);
    forgetProviderKey("datago");
    holdProviderKey("datago", KEY);

    expect(setItem).not.toHaveBeenCalled();
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        expect(store.getItem(store.key(i) ?? "") ?? "").not.toContain(KEY);
      }
    }
  });
});

describe("builderApi X-Provider-Key routing", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}));
  });

  function lastCall(): { url: string; headers: Record<string, string> } {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    return { url, headers: (init.headers ?? {}) as Record<string, string> };
  }

  const PROVIDER_CALLS: Array<[string, () => Promise<unknown>]> = [
    ["POST /preview", () => builderApi.preview("dataset_id: x")],
    ["POST /build", () => builderApi.build("dataset_id: x")],
    ["POST /builds", () => builderApi.submitBuild("dataset_id: x")],
    ["POST /providers/{p}/test", () => builderApi.testProviderConnection("datago")],
    ["GET /providers/{p}/status", () => builderApi.getProviderStatus("datago")],
    // Calls no provider, but its `configured` can only count a key it sees (contract 1.90.0).
    ["GET /providers", () => builderApi.listProviders()],
  ];

  it.each(PROVIDER_CALLS)("%s carries the held key in the header, never the URL", async (_name, call) => {
    holdProviderKey("datago", KEY);
    await call().catch(() => undefined);

    const { url, headers } = lastCall();
    expect(headers[PROVIDER_KEY_HEADER]).toBe(`datago=${KEY}`);
    expect(url).not.toContain(KEY);
    expect(url).not.toContain(encodeURIComponent(KEY));
  });

  it.each(PROVIDER_CALLS)("%s sends no X-Provider-Key when no key is held (single-user)", async (_name, call) => {
    await call().catch(() => undefined);
    expect(lastCall().headers).not.toHaveProperty(PROVIDER_KEY_HEADER);
  });

  it("routes that neither call a provider nor report what a key covers never carry the key", async () => {
    holdProviderKey("datago", KEY);
    const others: Array<() => Promise<unknown>> = [
      () => builderApi.version(),
      () => builderApi.getProviderCredential("datago"),
      () => builderApi.putProviderCredential("datago", "typed"),
      () => builderApi.validate("dataset_id: x"),
    ];
    for (const call of others) {
      await call().catch(() => undefined);
      const { url, headers } = lastCall();
      expect(headers).not.toHaveProperty(PROVIDER_KEY_HEADER);
      expect(url).not.toContain(KEY);
    }
  });
});
