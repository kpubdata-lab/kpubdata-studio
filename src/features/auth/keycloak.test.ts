// @vitest-environment jsdom
/**
 * keycloak.ts (OIDC singleton) test.
 *
 * Mock keycloak-js SDK boundary — don't actually call Keycloak over network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockKeycloak, KeycloakCtor } = vi.hoisted(() => {
  const mk = {
    authenticated: false as boolean,
    token: undefined as string | undefined,
    tokenParsed: undefined as unknown,
    init: vi.fn(),
    updateToken: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
  return { mockKeycloak: mk, KeycloakCtor: vi.fn(function () { return mk; }) };
});

vi.mock("keycloak-js", () => ({ default: KeycloakCtor }));

import {
  __resetKeycloakForTests,
  getFreshToken,
  initKeycloak,
  keycloakLogin,
  keycloakLogout,
} from "./keycloak";

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  vi.stubEnv("VITE_OIDC_ISSUER", "http://localhost:8080/realms/kpubdata");
  vi.stubEnv("VITE_OIDC_CLIENT_ID", "kpubdata-studio");
  vi.stubEnv("VITE_DEV_BYPASS_AUTH", "false");

  KeycloakCtor.mockClear();
  mockKeycloak.authenticated = false;
  mockKeycloak.token = undefined;
  mockKeycloak.tokenParsed = undefined;
  mockKeycloak.init.mockReset().mockResolvedValue(false);
  mockKeycloak.updateToken.mockReset().mockResolvedValue(true);
  mockKeycloak.login.mockReset().mockResolvedValue(undefined);
  mockKeycloak.logout.mockReset().mockResolvedValue(undefined);
  __resetKeycloakForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetKeycloakForTests();
});

describe("initKeycloak", () => {
  it("initializes check-sso with PKCE S256 and no login-required", async () => {
    await initKeycloak();
    expect(mockKeycloak.init).toHaveBeenCalledTimes(1);
    expect(mockKeycloak.init.mock.calls[0][0]).toMatchObject({
      onLoad: "check-sso",
      pkceMethod: "S256",
      checkLoginIframe: false,
    });
  });

  it("is memoized — a second call does not re-init", async () => {
    await initKeycloak();
    await initKeycloak();
    expect(mockKeycloak.init).toHaveBeenCalledTimes(1);
    expect(KeycloakCtor).toHaveBeenCalledTimes(1);
  });
});

describe("getFreshToken", () => {
  it("returns null without refreshing when there is no authenticated session", async () => {
    mockKeycloak.authenticated = false;
    await initKeycloak();
    await expect(getFreshToken()).resolves.toBeNull();
    expect(mockKeycloak.updateToken).not.toHaveBeenCalled();
  });

  it("coalesces concurrent refreshes into a single updateToken call", async () => {
    mockKeycloak.authenticated = true;
    let release: (v: boolean) => void = () => {};
    mockKeycloak.updateToken.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    await initKeycloak();

    const pending = Promise.all([getFreshToken(), getFreshToken(), getFreshToken()]);
    mockKeycloak.token = "fresh-access-token";
    release(true);
    const results = await pending;

    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      "fresh-access-token",
      "fresh-access-token",
      "fresh-access-token",
    ]);
  });

  it("issues a fresh updateToken call again after the previous one settled", async () => {
    mockKeycloak.authenticated = true;
    mockKeycloak.token = "t1";
    await initKeycloak();

    await getFreshToken();
    await getFreshToken();
    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(2);
  });

  it("returns null (does not surface a stale token) when refresh fails", async () => {
    mockKeycloak.authenticated = true;
    mockKeycloak.token = "stale";
    mockKeycloak.updateToken.mockRejectedValue(new Error("refresh failed"));
    await initKeycloak();

    await expect(getFreshToken()).resolves.toBeNull();
  });

  it("forces a refresh (minValidity -1) when asked", async () => {
    mockKeycloak.authenticated = true;
    mockKeycloak.token = "t";
    await initKeycloak();

    await getFreshToken({ force: true });
    expect(mockKeycloak.updateToken).toHaveBeenCalledWith(-1);
  });
});

describe("a forced refresh next to one already out (#984)", () => {
  /** An `updateToken` whose every call is settled by hand, in the order the calls were made. */
  function manualRefresh() {
    const calls: Array<{ minValidity: number; resolve: (refreshed: boolean) => void; reject: (cause: Error) => void }> = [];
    mockKeycloak.updateToken.mockImplementation(
      (minValidity: number) =>
        new Promise<boolean>((resolve, reject) => {
          calls.push({ minValidity, resolve, reject });
        }),
    );
    return calls;
  }

  beforeEach(async () => {
    mockKeycloak.authenticated = true;
    mockKeycloak.token = "refused-by-builder";
    await initKeycloak();
  });

  it("does not take the answer of a regular refresh that renewed nothing: it renews after it", async () => {
    const calls = manualRefresh();

    const regular = getFreshToken();
    const forced = getFreshToken({ force: true });
    await Promise.resolve();
    // Only the regular one is out; the forced one has not been answered with it.
    expect(calls.map((call) => call.minValidity)).toEqual([30]);

    // The regular refresh finds the token far from expiry and renews nothing.
    calls[0].resolve(false);
    await expect(regular).resolves.toBe("refused-by-builder");
    await vi.waitFor(() => expect(calls.map((call) => call.minValidity)).toEqual([30, -1]));

    mockKeycloak.token = "renewed";
    calls[1].resolve(true);
    await expect(forced).resolves.toBe("renewed");
  });

  it("shares one renewal between forced refreshes asked for at the same time", async () => {
    const calls = manualRefresh();

    const first = getFreshToken({ force: true });
    const second = getFreshToken({ force: true });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].minValidity).toBe(-1);

    mockKeycloak.token = "renewed";
    calls[0].resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual(["renewed", "renewed"]);
    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(1);
  });

  it("answers a regular refresh asked for during a forced one with that renewal", async () => {
    const calls = manualRefresh();

    const forced = getFreshToken({ force: true });
    const regular = getFreshToken();
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    mockKeycloak.token = "renewed";
    calls[0].resolve(true);
    await expect(Promise.all([forced, regular])).resolves.toEqual(["renewed", "renewed"]);
    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(1);
  });

  it("sends nothing more when the regular refresh ended the session (refresh token refused)", async () => {
    const calls = manualRefresh();

    const regular = getFreshToken();
    const forced = getFreshToken({ force: true });
    await Promise.resolve();

    // keycloak-js clears the session when the refresh grant is refused.
    mockKeycloak.authenticated = false;
    mockKeycloak.token = undefined;
    calls[0].reject(new Error("invalid_grant"));

    await expect(regular).resolves.toBeNull();
    await expect(forced).resolves.toBeNull();
    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(1);
  });

  it("renews once after a regular refresh that failed without ending the session", async () => {
    const calls = manualRefresh();

    const regular = getFreshToken();
    const forced = getFreshToken({ force: true });
    await Promise.resolve();
    calls[0].reject(new Error("network"));
    await expect(regular).resolves.toBeNull();
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    mockKeycloak.token = "renewed";
    calls[1].resolve(true);
    await expect(forced).resolves.toBe("renewed");
  });

  it("returns null when the forced renewal fails, and asks again the next time", async () => {
    const calls = manualRefresh();

    const forced = getFreshToken({ force: true });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0].reject(new Error("invalid_grant"));
    await expect(forced).resolves.toBeNull();

    const again = getFreshToken({ force: true });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    mockKeycloak.token = "renewed";
    calls[1].resolve(true);
    await expect(again).resolves.toBe("renewed");
    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(2);
  });
});

describe("login / logout", () => {
  it("keycloakLogin keeps the existing login options when no IdP hint is supplied", async () => {
    await keycloakLogin("/refresh-jobs?run=abc");
    expect(mockKeycloak.login).toHaveBeenCalledWith({
      redirectUri: `${window.location.origin}/login?returnTo=%2Frefresh-jobs%3Frun%3Dabc`,
    });
  });

  it("keycloakLogin passes an IdP hint through to Keycloak", async () => {
    await keycloakLogin("/refresh-jobs?run=abc", "google");
    expect(mockKeycloak.login).toHaveBeenCalledWith({
      redirectUri: `${window.location.origin}/login?returnTo=%2Frefresh-jobs%3Frun%3Dabc`,
      idpHint: "google",
    });
  });

  it("keycloakLogout redirects back to the app base path (not bare origin)", async () => {
    await keycloakLogout();
    expect(mockKeycloak.logout).toHaveBeenCalledWith({
      redirectUri: `${window.location.origin}/`,
    });
  });
});
