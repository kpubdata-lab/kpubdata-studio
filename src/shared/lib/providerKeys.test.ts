/**
 * Provider keys held for this page load (#652, kpubdata-builder#683, contract 1.56.0).
 *
 * Verifies the header form Builder parses (`<provider>=<key>`, comma-separated), that a
 * key never reaches browser storage or a URL, and that exactly the provider-calling routes
 * and the provider list (which reports what the held keys cover) carry it — and only
 * while a key is held, so a single-user deployment sends nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builderApi, SpecNotSentError } from "./builderApi";
import {
  PROVIDER_KEY_HEADER,
  forgetAllProviderKeys,
  forgetKeyProviders,
  forgetProviderKey,
  holdProviderKey,
  isProviderKeyHeld,
  noteKeyProviders,
  providerKeyHeaders,
  providerKeyProblem,
} from "./providerKeys";

const KEY = "dg-KEY-value+/abc==";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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

  // Every call that makes Builder call a provider with the user's key (#792). A retry is
  // a second call on their quota for one action, and the first may have reached the
  // provider — so each is sent once, whatever comes back.
  const CALLS_THAT_SPEND_A_KEY: Array<[string, () => Promise<unknown>]> = [
    ...PROVIDER_CALLS.filter(([name]) => name !== "GET /providers"),
    ["POST /providers/{p}/probe", () => builderApi.probeProviderKey("datago")],
  ];

  it.each(CALLS_THAT_SPEND_A_KEY)("%s is sent once when Builder answers 503", async (_name, call) => {
    holdProviderKey("datago", KEY);
    fetchMock.mockImplementation(async () => jsonResponse({ error: "unavailable" }, 503));

    await expect(call()).rejects.toMatchObject({ status: 503 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(CALLS_THAT_SPEND_A_KEY)("%s is sent once when the connection fails", async (_name, call) => {
    holdProviderKey("datago", KEY);
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(call()).rejects.toMatchObject({ status: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the list of calls that spend a key is every keyed call but the one that calls no provider", () => {
    expect(CALLS_THAT_SPEND_A_KEY.map(([name]) => name).sort()).toEqual([
      "GET /providers/{p}/status",
      "POST /build",
      "POST /builds",
      "POST /preview",
      "POST /providers/{p}/probe",
      "POST /providers/{p}/test",
    ]);
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

/** `GET /providers` items of a Builder that reports `key_provider`. */
const BUILDER_SAYS = [
  { provider: "datago", key_provider: "datago" },
  { provider: "localdata", key_provider: "datago" },
  { provider: "lofin", key_provider: "datago" },
  { provider: "semas", key_provider: "datago" },
  { provider: "seoul", key_provider: "seoul" },
  { provider: "bok", key_provider: "bok" },
];

describe("only the keys a request needs are sent (#770)", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  const SEOUL = "seoul-KEY-value";

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}));
    holdProviderKey("datago", KEY);
    holdProviderKey("seoul", SEOUL);
    // What Builder says in GET /providers (contract 1.98.0).
    noteKeyProviders(BUILDER_SAYS);
  });

  afterEach(() => forgetKeyProviders());

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

  // Forms Builder's parser accepts and Studio's read as naming no provider (#788): the
  // request went out with no key for a spec that calls datago.
  it.each([
    ["a provider given by a merge", "base: &b\n  provider: datago\nsources:\n  - <<: *b\n    dataset: a\n"],
    ["a key written twice", "sources:\n  - provider: seoul\n    dataset: a\n    provider: datago\n"],
    ["more than 100 alias uses", `p: &p datago\nsources:\n${"  - provider: *p\n    dataset: d\n".repeat(150)}`],
  ])("a spec with %s carries the key Builder will ask for, and no other", async (_name, spec) => {
    for (const call of [() => builderApi.preview(spec), () => builderApi.build(spec), () => builderApi.submitBuild(spec)]) {
      expect(await headerOf(call)).toBe(`datago=${KEY}`);
    }
  });

  it("a spec whose provider the two parsers would read differently is not sent at all", async () => {
    const spec = "a: &a {provider: seoul}\nc: &c {provider: datago}\nsources:\n  - <<: *a\n    <<: *c\n    dataset: d\n";

    for (const call of [() => builderApi.preview(spec), () => builderApi.build(spec), () => builderApi.submitBuild(spec)]) {
      const refused = await call().then(
        () => null,
        (cause: unknown) => cause,
      );
      expect(refused).toBeInstanceOf(SpecNotSentError);
      expect(refused).toMatchObject({ status: 400, code: "repeated_merge_key" });
      // The message says what to change and holds nothing from the spec or the keys.
      expect(String((refused as Error).message)).toContain("<<");
      expect(String((refused as Error).message)).not.toContain(KEY);
      expect(String((refused as Error).message)).not.toContain(SEOUL);
    }
    expect(fetchMock).not.toHaveBeenCalled();
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


describe("whose key a provider calls with comes from Builder (builder#1085)", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  const SEOUL = "seoul-KEY-value";

  beforeEach(() => {
    forgetKeyProviders();
    holdProviderKey("datago", KEY);
    holdProviderKey("seoul", SEOUL);
  });

  afterEach(() => forgetKeyProviders());

  async function headerOf(call: () => Promise<unknown>): Promise<string[]> {
    await call().catch(() => undefined);
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    const header = ((init.headers ?? {}) as Record<string, string>)[PROVIDER_KEY_HEADER];
    return header ? header.split(",").sort() : [];
  }

  const both = [`datago=${KEY}`, `seoul=${SEOUL}`].sort();

  it("before Builder has said, every held key is sent rather than one left out on a guess", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}));

    expect(await headerOf(() => builderApi.preview(specOf("localdata")))).toEqual(both);
    expect(await headerOf(() => builderApi.testProviderConnection("seoul"))).toEqual(both);
  });

  it("listProviders teaches it, and from then on only the needed keys are sent", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/providers")
        ? jsonResponse({
            providers: [
              { provider: "datago", requires_credential: true, configured: true, key_provider: "datago" },
              { provider: "localdata", requires_credential: true, configured: true, key_provider: "datago" },
              { provider: "seoul", requires_credential: true, configured: true, key_provider: "seoul" },
            ],
          })
        : jsonResponse({}),
    );
    await builderApi.listProviders();

    expect(await headerOf(() => builderApi.preview(specOf("localdata")))).toEqual([`datago=${KEY}`]);
    expect(await headerOf(() => builderApi.preview(specOf("seoul")))).toEqual([`seoul=${SEOUL}`]);
  });

  it("a Builder that does not say leaves it unknown: every held key, as before #770", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/providers")
        ? jsonResponse({ providers: [{ provider: "seoul", requires_credential: true, configured: true }] })
        : jsonResponse({}),
    );
    await builderApi.listProviders();

    expect(await headerOf(() => builderApi.preview(specOf("seoul")))).toEqual(both);
  });

  it("what a newer Builder said is not forgotten when a later answer says nothing", () => {
    noteKeyProviders([{ provider: "localdata", key_provider: "datago" }]);
    noteKeyProviders([{ provider: "localdata" }]);

    expect(providerKeyHeaders(["localdata"])).toEqual({ [PROVIDER_KEY_HEADER]: `datago=${KEY}` });
  });

  it("no copy of the table is left in Studio", () => {
    const source = readFileSync(join(process.cwd(), "src/shared/lib/providerKeys.ts"), "utf8");

    expect(source).not.toMatch(/localdata|lofin|semas/);
  });
});
