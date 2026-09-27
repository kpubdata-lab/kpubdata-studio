/**
 * Add Data local draft — secret redaction on save (PR #283 review response, Epic #246).
 *
 * Verify url source secret query parameters don't save to localStorage as plaintext,
 * and restored redacted draft cannot Preview/Build without re-entering.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAddDataDraft, loadAddDataDraft, saveAddDataDraft } from "./draftStorage";
import { INITIAL_DRAFT, buildSpecFromDraft, type AddDataDraft } from "./model";

function urlDraft(endpoint: string): AddDataDraft {
  return {
    ...INITIAL_DRAFT,
    sourceKind: "url",
    url: { endpoint, format: null },
    datasetId: "d",
    title: "t",
    description: "desc",
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("saveAddDataDraft — secret redaction (#283)", () => {
  it("Original ?token=<secret> not in localStorage", () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz012345";
    saveAddDataDraft(urlDraft(`https://api.example.org/v1?token=${secret}`));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
  });

  it("High-entropy credential value not in localStorage regardless of key name", () => {
    const secret = "Zx8pQ2vR7mK4nL9wT1yB6cU3sD0fH5jA8gE2rN7iM4x";
    saveAddDataDraft(urlDraft(`https://api.example.org/v1?auth=${secret}`));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
  });

  it("Non-sensitive query parameters preserved in saved draft", () => {
    saveAddDataDraft(urlDraft("https://api.example.org/data?region=seoul&year=2024"));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).toContain("region=seoul");
    expect(raw).toContain("year=2024");
  });

  it("Restored redacted draft cannot Preview/Build without secret re-entry", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    saveAddDataDraft(urlDraft(`https://api.example.org/data?api_key=${secret}`));

    const restored = loadAddDataDraft();
    expect(restored).not.toBeNull();
    expect(restored!.url.endpoint).not.toContain(secret);

    const result = buildSpecFromDraft(restored!);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/다시 입력/);
  });

  it("Source not url, but leftover draft.url.endpoint secret cleared on save", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const draft: AddDataDraft = {
      ...INITIAL_DRAFT,
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams: "{}" },
      url: { endpoint: `https://api.example.org/data?api_key=${secret}`, format: null },
    };
    saveAddDataDraft(draft);
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
  });
});

describe("saveAddDataDraft — malformed URL fail-closed (#283 follow-up §2)", () => {
  it("not-a-url?token=<secret> saved without original/secret in localStorage", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    saveAddDataDraft(urlDraft(`not-a-url?token=${secret}`));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("not-a-url");
  });

  it("After restore, cannot Preview/Build without endpoint re-entry", () => {
    saveAddDataDraft(urlDraft("not-a-url?token=abc"));
    const restored = loadAddDataDraft();
    expect(restored).not.toBeNull();
    expect(restored!.url.endpoint).toBe("");
    const result = buildSpecFromDraft(restored!);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/Endpoint를 입력/);
  });
});

describe("saveAddDataDraft — URL sentinel collision (#283 follow-up §3)", () => {
  it("Normal parameter value ('REDACTED') not mistaken for credential loss", () => {
    saveAddDataDraft(urlDraft("https://api.example.org/data?status=REDACTED"));
    const restored = loadAddDataDraft();
    const result = buildSpecFromDraft(restored!);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).toMatchObject({ endpoint: "https://api.example.org/data?status=REDACTED" });
  });
});

describe("saveAddDataDraft — URL userinfo credential (#283 follow-up §4)", () => {
  it("https://user:password@api.example.org/data saved without original credential, fail-closed", () => {
    saveAddDataDraft(urlDraft("https://user:password@api.example.org/data"));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain("user:password");

    const restored = loadAddDataDraft();
    expect(restored!.url.endpoint).toBe("");
    const result = buildSpecFromDraft(restored!);
    expect(result.spec).toBeUndefined();
  });

  it("buildSpecFromDraft rejects in-memory userinfo credential, no URL Auth conversion", () => {
    const draft = urlDraft("https://user:password@api.example.org/data");
    const result = buildSpecFromDraft(draft);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/사용자 정보/);
  });
});

describe("saveAddDataDraft — public_api sourceParams secret redaction (#283 follow-up §1)", () => {
  function publicApiDraft(sourceParams: string): AddDataDraft {
    return {
      ...INITIAL_DRAFT,
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "apt_trade", sourceParams },
      datasetId: "d",
      title: "t",
      description: "desc",
    };
  }

  it("Original serviceKey not in localStorage", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    saveAddDataDraft(publicApiDraft(JSON.stringify({ page: 1, serviceKey: secret })));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
     // Non-sensitive param(page) key name itself preserved (independent of
    // nested JSON string escaping, confirm substring without quotes).
    expect(raw).toContain("page");
  });

  it("Restored redacted draft cannot Preview/Build without re-entry", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    saveAddDataDraft(publicApiDraft(JSON.stringify({ api_key: secret })));
    const restored = loadAddDataDraft();
    expect(restored).not.toBeNull();
    expect(restored!.publicApi.sourceParams).not.toContain(secret);

    const result = buildSpecFromDraft(restored!);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/다시 입력/);
  });

  it("Display/draft redaction preserves original params in actual in-memory submission spec", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const draft = publicApiDraft(JSON.stringify({ serviceKey: secret }));
    saveAddDataDraft(draft); // Save only creates copy — passed draft object itself unchanged.
    expect(draft.publicApi.sourceParams).toContain(secret);

    const result = buildSpecFromDraft(draft);
    expect(result.spec?.sources[0].params.serviceKey).toBe(secret);
  });
});

describe("clearAddDataDraft", () => {
  it("Clears saved draft", () => {
    saveAddDataDraft(urlDraft("https://api.example.org/data"));
    clearAddDataDraft();
    expect(loadAddDataDraft()).toBeNull();
  });
});
