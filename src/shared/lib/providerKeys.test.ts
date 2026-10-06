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

/** A BuildSpec whose sources call the given providers. */
function specOf(...providers: string[]): string {
  return ["dataset_id: x", "sources:", ...providers.map((name) => `  - provider: ${name}\n    dataset: d`)].join("\n");
}

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
    ["POST /preview", () => builderApi.preview(specOf("datago"))],
    ["POST /build", () => builderApi.build(specOf("datago"))],
    ["POST /builds", () => builderApi.submitBuild(specOf("datago"))],
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

describe("only the keys a request needs are sent (#770)", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  const SEOUL = "seoul-KEY-value";

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}));
    holdProviderKey("datago", KEY);
    holdProviderKey("seoul", SEOUL);
  });

  async function headerOf(call: () => Promise<unknown>): Promise<string | undefined> {
    await call().catch(() => undefined);
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    return ((init.headers ?? {}) as Record<string, string>)[PROVIDER_KEY_HEADER];
  }

  const SPEC_CALLS: Array<[string, (spec: string) => Promise<unknown>]> = [
    ["preview", (spec) => builderApi.preview(spec)],
    ["build", (spec) => builderApi.build(spec)],
    ["submitBuild", (spec) => builderApi.submitBuild(spec)],
  ];

  it.each(SPEC_CALLS)("%s of a seoul-only spec carries the seoul key and not the datago one", async (_name, call) => {
    const header = await headerOf(() => call(specOf("seoul")));

    expect(header).toBe(`seoul=${SEOUL}`);
    expect(header).not.toContain(KEY);
  });

  it.each(SPEC_CALLS)("%s of a localdata spec carries the datago key it calls with", async (_name, call) => {
    expect(await headerOf(() => call(specOf("localdata")))).toBe(`datago=${KEY}`);
  });

  it("a spec that mixes providers carries each one's key once", async () => {
    const header = await headerOf(() => builderApi.preview(specOf("datago", "seoul", "datago", "lofin")));

    expect(header?.split(",").sort()).toEqual([`datago=${KEY}`, `seoul=${SEOUL}`].sort());
  });

  it.each([
    ["no provider source", "dataset_id: x\nsources:\n  - kind: file\n    upload_id: u1"],
    ["no sources", "dataset_id: x"],
    ["YAML that cannot be read", "sources: [unclosed"],
    ["a provider no key is held for", specOf("bok")],
  ])("a spec with %s carries no key", async (_name, spec) => {
    expect(await headerOf(() => builderApi.preview(spec))).toBeUndefined();
  });

  it.each([
    ["testProviderConnection", (provider: string) => builderApi.testProviderConnection(provider)],
    ["getProviderStatus", (provider: string) => builderApi.getProviderStatus(provider)],
    ["probeProviderKey", (provider: string) => builderApi.probeProviderKey(provider)],
  ])("%s carries the named provider's key only", async (_name, call) => {
    expect(await headerOf(() => call("seoul"))).toBe(`seoul=${SEOUL}`);
    expect(await headerOf(() => call("semas"))).toBe(`datago=${KEY}`);
    expect(await headerOf(() => call("bok"))).toBeUndefined();
  });

  it("listProviders still carries every held key: it asks what they cover", async () => {
    const header = await headerOf(() => builderApi.listProviders());

    expect(header?.split(",").sort()).toEqual([`datago=${KEY}`, `seoul=${SEOUL}`].sort());
  });

  it("with no key held, nothing is sent whatever the spec names", async () => {
    forgetAllProviderKeys();

    expect(await headerOf(() => builderApi.preview(specOf("datago", "seoul")))).toBeUndefined();
    expect(await headerOf(() => builderApi.listProviders())).toBeUndefined();
  });
});

