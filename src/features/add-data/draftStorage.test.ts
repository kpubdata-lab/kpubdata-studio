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
  it("?token=<secret> 원문이 localStorage에 없다", () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz012345";
    saveAddDataDraft(urlDraft(`https://api.example.org/v1?token=${secret}`));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
  });

  it("고엔트로피 credential 값이 key 이름과 무관하게 localStorage에 없다", () => {
    const secret = "Zx8pQ2vR7mK4nL9wT1yB6cU3sD0fH5jA8gE2rN7iM4x";
    saveAddDataDraft(urlDraft(`https://api.example.org/v1?auth=${secret}`));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
  });

  it("일반 비민감 query parameter는 저장된 초안에서도 유지된다", () => {
    saveAddDataDraft(urlDraft("https://api.example.org/data?region=seoul&year=2024"));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).toContain("region=seoul");
    expect(raw).toContain("year=2024");
  });

  it("저장된 redacted draft를 복원하면 secret 재입력 없이는 Preview/Build를 진행할 수 없다", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    saveAddDataDraft(urlDraft(`https://api.example.org/data?api_key=${secret}`));

    const restored = loadAddDataDraft();
    expect(restored).not.toBeNull();
    expect(restored!.url.endpoint).not.toContain(secret);

    const result = buildSpecFromDraft(restored!);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/다시 입력/);
  });

  it("소스가 url이 아니어도 draft.url.endpoint에 남아있던 secret은 저장 시 지워진다", () => {
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

describe("saveAddDataDraft — malformed URL fail-closed (#283 후속 리뷰 §2)", () => {
  it("not-a-url?token=<secret>은 localStorage에 원문/secret 없이 저장된다", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    saveAddDataDraft(urlDraft(`not-a-url?token=${secret}`));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("not-a-url");
  });

  it("복원 후 endpoint 재입력 없이는 Preview/Build를 진행할 수 없다", () => {
    saveAddDataDraft(urlDraft("not-a-url?token=abc"));
    const restored = loadAddDataDraft();
    expect(restored).not.toBeNull();
    expect(restored!.url.endpoint).toBe("");
    const result = buildSpecFromDraft(restored!);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/Endpoint를 입력/);
  });
});

describe("saveAddDataDraft — URL sentinel collision (#283 후속 리뷰 §3)", () => {
  it("정상 query parameter 값('REDACTED')을 credential 소실 상태로 오인하지 않는다", () => {
    saveAddDataDraft(urlDraft("https://api.example.org/data?status=REDACTED"));
    const restored = loadAddDataDraft();
    const result = buildSpecFromDraft(restored!);
    expect(result.error).toBeUndefined();
    expect(result.spec?.sources[0]).toMatchObject({ endpoint: "https://api.example.org/data?status=REDACTED" });
  });
});

describe("saveAddDataDraft — URL userinfo credential (#283 후속 리뷰 §4)", () => {
  it("https://user:password@api.example.org/data는 원문 credential 없이 저장되고 fail-closed된다", () => {
    saveAddDataDraft(urlDraft("https://user:password@api.example.org/data"));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain("user:password");

    const restored = loadAddDataDraft();
    expect(restored!.url.endpoint).toBe("");
    const result = buildSpecFromDraft(restored!);
    expect(result.spec).toBeUndefined();
  });

  it("buildSpecFromDraft는 in-memory userinfo credential도 URL Auth로 변환하지 않고 거부한다", () => {
    const draft = urlDraft("https://user:password@api.example.org/data");
    const result = buildSpecFromDraft(draft);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/사용자 정보/);
  });
});

describe("saveAddDataDraft — public_api sourceParams secret redaction (#283 후속 리뷰 §1)", () => {
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

  it("serviceKey 원문이 localStorage에 없다", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    saveAddDataDraft(publicApiDraft(JSON.stringify({ page: 1, serviceKey: secret })));
    const raw = localStorage.getItem("kpubdata-studio:add-data-draft") ?? "";
    expect(raw).not.toContain(secret);
    // 비민감 param(page)의 key 이름 자체는 유지된다(중첩 JSON 문자열 escape 여부와
    // 무관하게 검증하기 위해 quote 없이 부분 문자열만 확인한다).
    expect(raw).toContain("page");
  });

  it("저장된 redacted draft를 복원하면 재입력 없이는 Preview/Build를 진행할 수 없다", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    saveAddDataDraft(publicApiDraft(JSON.stringify({ api_key: secret })));
    const restored = loadAddDataDraft();
    expect(restored).not.toBeNull();
    expect(restored!.publicApi.sourceParams).not.toContain(secret);

    const result = buildSpecFromDraft(restored!);
    expect(result.spec).toBeUndefined();
    expect(result.error).toMatch(/다시 입력/);
  });

  it("display/draft redaction을 수행해도 현재 세션의 실제 in-memory submission spec에는 원문 params가 유지된다", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const draft = publicApiDraft(JSON.stringify({ serviceKey: secret }));
    saveAddDataDraft(draft); // 저장은 사본만 만든다 — 전달한 draft 객체 자체는 변형되지 않는다.
    expect(draft.publicApi.sourceParams).toContain(secret);

    const result = buildSpecFromDraft(draft);
    expect(result.spec?.sources[0].params.serviceKey).toBe(secret);
  });
});

describe("clearAddDataDraft", () => {
  it("저장된 초안을 지운다", () => {
    saveAddDataDraft(urlDraft("https://api.example.org/data"));
    clearAddDataDraft();
    expect(loadAddDataDraft()).toBeNull();
  });
});
