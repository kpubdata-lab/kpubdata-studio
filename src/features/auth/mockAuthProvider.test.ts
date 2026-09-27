/**
 * mockAuthProvider (#263) test.
 *
 * Verify generic AuthProvider contract (signIn/signUp/signOut) works in mock mode, failure
 * message path exists, and returned AuthSession never includes password.
 */
import { describe, expect, it } from "vitest";
import { mockAuthProvider } from "./mockAuthProvider";
import { AuthError } from "./types";

describe("mockAuthProvider", () => {
  it("has a stable provider id", () => {
    expect(mockAuthProvider.id).toBe("mock");
  });

  describe("signIn", () => {
    it("succeeds and returns a session that never includes the password", async () => {
      const session = await mockAuthProvider.signIn({ email: "user@example.com", password: "hunter2" });
      expect(session).toMatchObject({ email: "user@example.com", name: null, provider: "mock" });
      expect(session.token).toBeTruthy();
      expect(JSON.stringify(session)).not.toMatch(/hunter2/);
    });

    it("issues a different token per call (not a fixed/shared demo token)", async () => {
      const first = await mockAuthProvider.signIn({ email: "a@example.com", password: "abcd" });
      const second = await mockAuthProvider.signIn({ email: "a@example.com", password: "abcd" });
      expect(first.token).not.toBe(second.token);
    });

    it("rejects with an AuthError (실패 메시지 경로) for a too-short password", async () => {
      await expect(
        mockAuthProvider.signIn({ email: "user@example.com", password: "ab" }),
      ).rejects.toBeInstanceOf(AuthError);
    });

    it("AuthError carries a Korean user-facing message", async () => {
      await expect(mockAuthProvider.signIn({ email: "user@example.com", password: "" })).rejects.toThrow(
        "이메일 또는 비밀번호가 올바르지 않습니다.",
      );
    });
  });

  describe("signUp", () => {
    it("returns a session carrying the provided name, and never the password", async () => {
      const session = await mockAuthProvider.signUp({
        name: "홍길동",
        email: "new@example.com",
        password: "hunter2",
        accountType: "individual",
      });
      expect(session).toMatchObject({ name: "홍길동", email: "new@example.com", provider: "mock" });
      expect(JSON.stringify(session)).not.toMatch(/hunter2/);
    });

    it("does not require organizationName for an individual account", async () => {
      await expect(
        mockAuthProvider.signUp({
          name: "홍길동",
          email: "new@example.com",
          password: "hunter2",
          accountType: "individual",
        }),
      ).resolves.toBeDefined();
    });

    it("accepts an organization account with an organizationName", async () => {
      const session = await mockAuthProvider.signUp({
        name: "홍길동",
        email: "team@example.com",
        password: "hunter2",
        accountType: "organization",
        organizationName: "KPubData Lab",
      });
      expect(session.email).toBe("team@example.com");
    });
  });

  describe("signOut", () => {
    it("resolves without throwing (no server session to revoke in mock mode)", async () => {
      await expect(mockAuthProvider.signOut()).resolves.toBeUndefined();
    });
  });
});
