/**
 * The Ask KPubData LLM key belongs to the signed-in user (kpubdata#812).
 *
 * It was one value for the browser: kept in memory across sign-out and saved under one
 * storage key. The next person at the same browser then sent their questions with the
 * previous person's key. These pin that a key follows its user and leaves with them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistConfig } from "@/features/assistant/config";
import { useAuthStore } from "@/features/auth/store";

const ISSUER = "https://id.example/realms/kpubdata";
const GLOBAL_KEY = "kpubdata-assist-key";
const keyOf = (subject: string) => `${GLOBAL_KEY}:sub:${ISSUER}#${subject}`;

function signIn(subject: string) {
  useAuthStore.getState().setOidcIdentity({
    email: `${subject}@example.com`,
    name: null,
    userId: subject,
    issuer: ISSUER,
    emailVerified: true,
  });
}

function signOut() {
  useAuthStore.getState().clear();
}

function saveKey(apiKey: string) {
  useAssistConfig.getState().setConfig({ apiKey });
  useAssistConfig.getState().enablePersistence();
}

beforeEach(() => {
  signOut();
  localStorage.clear();
  useAssistConfig.setState({ apiKey: "", isConfigured: false, persistToStorage: false });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  signOut();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the assistant key and the signed-in user (kpubdata#812)", () => {
  it("is saved under the signed-in user's own key, not the browser's", () => {
    signIn("alice");
    saveKey("sk-alice");

    expect(localStorage.getItem(keyOf("alice"))).toBe("sk-alice");
    expect(localStorage.getItem(GLOBAL_KEY)).toBeNull();
  });

  it("leaves memory and storage when its user signs out", () => {
    signIn("alice");
    saveKey("sk-alice");

    signOut();

    expect(useAssistConfig.getState()).toMatchObject({ apiKey: "", isConfigured: false, persistToStorage: false });
    expect(localStorage.getItem(keyOf("alice"))).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toContain("sk-alice");
  });

  it("a key held only in memory is dropped at sign-out too", () => {
    signIn("alice");
    useAssistConfig.getState().setConfig({ apiKey: "sk-alice-memory" });

    signOut();

    expect(useAssistConfig.getState().apiKey).toBe("");
    expect(useAssistConfig.getState().isConfigured).toBe(false);
  });

  it("the next user at the same browser does not get the previous user's key", () => {
    signIn("alice");
    saveKey("sk-alice");

    // Another account takes over the session without an explicit sign-out in between.
    signIn("bob");

    expect(useAssistConfig.getState()).toMatchObject({ apiKey: "", isConfigured: false });
    expect(localStorage.getItem(keyOf("alice"))).toBeNull();
    expect(localStorage.getItem(keyOf("bob"))).toBeNull();
  });

  it("gives the old browser-wide key to no one, and deletes it at the first sign-in", () => {
    localStorage.setItem(GLOBAL_KEY, "sk-whose");

    signIn("alice");

    expect(useAssistConfig.getState()).toMatchObject({ apiKey: "", isConfigured: false });
    expect(localStorage.getItem(GLOBAL_KEY)).toBeNull();
    expect(localStorage.getItem(keyOf("alice"))).toBeNull();
  });

  it("a user's saved key comes back when their session is restored after a reload", () => {
    // What a reload looks like: the saved entry is in storage, memory is empty, and the
    // identity arrives once the session is restored.
    localStorage.setItem(keyOf("alice"), "sk-alice");

    signIn("alice");

    expect(useAssistConfig.getState()).toMatchObject({ apiKey: "sk-alice", isConfigured: true, persistToStorage: true });
  });

  it("a token refresh that keeps the same user keeps the key", () => {
    signIn("alice");
    useAssistConfig.getState().setConfig({ apiKey: "sk-alice-memory" });

    signIn("alice");

    expect(useAssistConfig.getState().apiKey).toBe("sk-alice-memory");
  });

  it("without sign-in the key is the browser's, as before", () => {
    saveKey("sk-single-user");

    expect(localStorage.getItem(GLOBAL_KEY)).toBe("sk-single-user");
    useAssistConfig.getState().disablePersistence();
    expect(localStorage.getItem(GLOBAL_KEY)).toBeNull();
  });
});
