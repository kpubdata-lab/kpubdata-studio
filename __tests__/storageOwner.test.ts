/**
 * 사용자별 localStorage 저장 격리 테스트 (#293).
 *
 * - 로그인 사용자마다 별도 버킷(Saved BuildSpec/Report/초안)
 * - 로그아웃 상태는 기존 무소속 키(하위 호환, 데모 데이터 무손실)
 * - 다른 사용자 로그인 시 이전 사용자 초안 자동 복원 없음
 * - 전체 삭제는 현재 소유자 버킷만
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/features/auth/store";
import { migrateEmailOwnedStorage, ownedStorageKey, resolveStorageOwnerKey } from "@/features/auth/storageOwner";
import { clearAllSavedSpecs, createSavedSpec, listSavedSpecSummaries } from "@/features/workspace/savedSpecs";
import { saveDraft, loadDraft } from "@/features/build-spec/draftStorage";

function emptySpec() {
  return {
    datasetId: "demo",
    title: "demo",
    description: "",
    sources: [],
    exports: [],
    metadata: {},
  } as never;
}

describe("storageOwner (#293)", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
  });

  afterEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
  });

  it("미로그인은 무소속 키를 그대로 쓴다(하위 호환)", () => {
    expect(ownedStorageKey("kpubdata-studio:saved-build-specs")).toBe(
      "kpubdata-studio:saved-build-specs",
    );
    expect(resolveStorageOwnerKey()).toBe("anonymous");
  });

  it("이메일을 정규화(trim+lowercase)한 소유자 키로 네임스페이싱한다", () => {
    useAuthStore.getState().setSession({
      token: "t",
      email: "  User@Example.COM ",
      name: null,
      provider: "mock",
    });

    expect(resolveStorageOwnerKey()).toBe("user:user@example.com");
    expect(ownedStorageKey("kpubdata-studio:saved-build-specs")).toBe(
      "kpubdata-studio:saved-build-specs:user:user@example.com",
    );
  });

  it("사용자마다 Saved BuildSpec 버킷이 분리된다", () => {
    useAuthStore.getState().setSession({
      token: "t1",
      email: "a@example.com",
      name: null,
      provider: "mock",
    });
    createSavedSpec({ name: "A의 스펙", spec: emptySpec(), validation: { status: "not_validated", errors: [] } });
    expect(listSavedSpecSummaries()).toHaveLength(1);

    useAuthStore.getState().setSession({
      token: "t2",
      email: "b@example.com",
      name: null,
      provider: "mock",
    });
    expect(listSavedSpecSummaries()).toHaveLength(0);

    useAuthStore.getState().clear();
    expect(listSavedSpecSummaries()).toHaveLength(0);
  });

  it("다른 사용자 로그인 시 이전 사용자 초안이 자동으로 열리지 않는다", () => {
    useAuthStore.getState().setSession({
      token: "t1",
      email: "a@example.com",
      name: null,
      provider: "mock",
    });
    saveDraft({ title: "A의 초안" });

    useAuthStore.getState().setSession({
      token: "t2",
      email: "b@example.com",
      name: null,
      provider: "mock",
    });
    expect(loadDraft<{ title: string }>()).toBeNull();
  });

  it("전체 삭제는 현재 소유자 버킷만 지운다", () => {
    useAuthStore.getState().setSession({
      token: "t1",
      email: "a@example.com",
      name: null,
      provider: "mock",
    });
    createSavedSpec({ name: "A의 스펙", spec: emptySpec(), validation: { status: "not_validated", errors: [] } });

    useAuthStore.getState().setSession({
      token: "t2",
      email: "b@example.com",
      name: null,
      provider: "mock",
    });
    createSavedSpec({ name: "B의 스펙", spec: emptySpec(), validation: { status: "not_validated", errors: [] } });

    expect(clearAllSavedSpecs()).toBe(true);
    expect(listSavedSpecSummaries()).toHaveLength(0);

    useAuthStore.getState().setSession({
      token: "t1",
      email: "a@example.com",
      name: null,
      provider: "mock",
    });
    expect(listSavedSpecSummaries()).toHaveLength(1);
  });
});

describe("storageOwner keyed by issuer and subject (#731)", () => {
  const ISSUER = "https://id.example/realms/kpubdata";
  const oidc = (identity: { email: string | null; userId: string | null; issuer?: string | null }) =>
    useAuthStore.getState().setOidcIdentity({ name: null, ...identity });

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
  });

  afterEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
  });

  it("an OIDC session is owned by issuer and subject, not by its e-mail", () => {
    oidc({ email: "user@example.com", userId: "sub-1", issuer: ISSUER });

    expect(resolveStorageOwnerKey()).toBe(`sub:${ISSUER}#sub-1`);
    expect(ownedStorageKey("kpubdata-studio:reports")).toBe(`kpubdata-studio:reports:sub:${ISSUER}#sub-1`);
  });

  it("the same e-mail at another issuer, or under another subject, is another owner", () => {
    oidc({ email: "user@example.com", userId: "sub-1", issuer: ISSUER });
    const first = resolveStorageOwnerKey();
    oidc({ email: "user@example.com", userId: "sub-1", issuer: "https://other.example/realms/x" });
    const otherIssuer = resolveStorageOwnerKey();
    oidc({ email: "user@example.com", userId: "sub-2", issuer: ISSUER });
    const otherSubject = resolveStorageOwnerKey();

    expect(new Set([first, otherIssuer, otherSubject]).size).toBe(3);
  });

  it("a changed e-mail keeps the same owner", () => {
    oidc({ email: "old@example.com", userId: "sub-1", issuer: ISSUER });
    const before = resolveStorageOwnerKey();
    oidc({ email: "new@example.com", userId: "sub-1", issuer: ISSUER });

    expect(resolveStorageOwnerKey()).toBe(before);
  });

  it("an identity without a subject or an issuer falls back to the e-mail key", () => {
    oidc({ email: "user@example.com", userId: null, issuer: ISSUER });
    expect(resolveStorageOwnerKey()).toBe("user:user@example.com");
    oidc({ email: "user@example.com", userId: "sub-1" });
    expect(resolveStorageOwnerKey()).toBe("user:user@example.com");
  });

  it("moves what was saved under the e-mail key, for every feature's key", () => {
    localStorage.setItem("kpubdata-studio:reports:user:user@example.com", "[1]");
    localStorage.setItem("kpubdata-studio:saved-build-specs:user:user@example.com", "[2]");
    localStorage.setItem("kpubdata-studio:reports:user:someone-else@example.com", "[3]");
    localStorage.setItem("kpubdata-studio:reports", "[anonymous]");
    oidc({ email: " User@Example.com ", userId: "sub-1", issuer: ISSUER });

    expect(migrateEmailOwnedStorage()).toBe(2);

    const owner = `sub:${ISSUER}#sub-1`;
    expect(localStorage.getItem(`kpubdata-studio:reports:${owner}`)).toBe("[1]");
    expect(localStorage.getItem(`kpubdata-studio:saved-build-specs:${owner}`)).toBe("[2]");
    expect(localStorage.getItem("kpubdata-studio:reports:user:user@example.com")).toBeNull();
    // Another user's bucket and the anonymous one are not touched.
    expect(localStorage.getItem("kpubdata-studio:reports:user:someone-else@example.com")).toBe("[3]");
    expect(localStorage.getItem("kpubdata-studio:reports")).toBe("[anonymous]");
    // A second sign-in finds nothing left to move.
    expect(migrateEmailOwnedStorage()).toBe(0);
  });

  it("does not overwrite data already saved under the new key", () => {
    const owner = `sub:${ISSUER}#sub-1`;
    localStorage.setItem("kpubdata-studio:reports:user:user@example.com", "[old]");
    localStorage.setItem(`kpubdata-studio:reports:${owner}`, "[new]");
    oidc({ email: "user@example.com", userId: "sub-1", issuer: ISSUER });

    expect(migrateEmailOwnedStorage()).toBe(0);
    expect(localStorage.getItem(`kpubdata-studio:reports:${owner}`)).toBe("[new]");
    expect(localStorage.getItem("kpubdata-studio:reports:user:user@example.com")).toBe("[old]");
  });

  it("a mock session has nothing to migrate and keeps its e-mail key", () => {
    localStorage.setItem("kpubdata-studio:reports:user:user@example.com", "[1]");
    useAuthStore.getState().setSession({ token: "t", email: "user@example.com", name: null, provider: "mock" });

    expect(migrateEmailOwnedStorage()).toBe(0);
    expect(resolveStorageOwnerKey()).toBe("user:user@example.com");
  });

  it("a saved spec made before the change is still listed after sign-in migrates it", () => {
    useAuthStore.getState().setSession({ token: "t", email: "user@example.com", name: null, provider: "mock" });
    createSavedSpec({ name: "before", spec: emptySpec(), validation: { status: "not_validated", errors: [] } });
    oidc({ email: "user@example.com", userId: "sub-1", issuer: ISSUER });
    expect(listSavedSpecSummaries()).toHaveLength(0);

    migrateEmailOwnedStorage();

    expect(listSavedSpecSummaries().map((spec) => spec.name)).toEqual(["before"]);
  });
});
