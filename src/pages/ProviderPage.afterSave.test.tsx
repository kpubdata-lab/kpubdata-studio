/**
 * The connections panel says whose key is in use as soon as that changes (#845).
 *
 * A provider the Builder has a default key for reads "using the Builder's default
 * credential". Once the user saves a key of their own, the panel has to say that — and
 * go back when the key is deleted — without a reload of the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { delay, http, HttpResponse } from "msw";

import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../../vitest.setup";
import { ProviderPage } from "./ProviderPage";

const DEFAULT_NOTE = /Builder 기본 자격 증명으로 사용 중/;
const LOADING = "자격 증명 상태를 불러오는 중…";
const READ_FAILED = "자격 증명 상태를 불러오지 못했습니다";
/** The readiness label of a provider some key works for, whoever's it is. */
const READY = "연결 준비됨";
const NO_KEY = "API Key 미설정";
const NEEDS_KEY = "이 제공 기관을 사용하려면 자격 증명을 등록해야 합니다.";

/**
 * How the Builder answers the reads that follow a save or a delete: both, neither, or
 * one of the two — the provider's own key (`fails`) or the list (`list fails`).
 */
type After = "answers" | "never answers" | "fails" | "list fails";

/**
 * A Builder with whatever the user has stored for datago and, unless `defaultKey` is
 * false, a default key of its own for it.
 */
function builder(after: After = "answers", { defaultKey = true }: { defaultKey?: boolean } = {}) {
  const state = { stored: false, changed: false, summaryCalls: 0, credentialCalls: 0 };
  const held = async () => {
    if (state.changed && after === "never answers") await delay("infinite");
  };
  mswServer.use(
    http.get(`${API_BASE}/providers`, async () => {
      state.summaryCalls += 1;
      await held();
      if (state.changed && after === "list fails") return HttpResponse.json({ error: "boom" }, { status: 500 });
      // Configured by the default key, or by the user's: the list does not say which.
      return HttpResponse.json({
        providers: [
          { provider: "datago", requires_credential: true, configured: defaultKey || state.stored, key_provider: "datago" },
        ],
      });
    }),
    http.get(`${API_BASE}/providers/datago/credential`, async () => {
      state.credentialCalls += 1;
      await held();
      if (state.changed && after === "fails") return HttpResponse.json({ error: "boom" }, { status: 500 });
      return HttpResponse.json(
        state.stored
          ? { configured: true, masked: "dg••••99", updated_at: "2026-10-08T00:00:00+00:00" }
          : { configured: false, masked: null, updated_at: null },
      );
    }),
    http.put(`${API_BASE}/providers/datago/credential`, () => {
      state.stored = true;
      state.changed = true;
      return HttpResponse.json({ provider: "datago", configured: true, masked: "dg••••99", updated_at: null });
    }),
    http.delete(`${API_BASE}/providers/datago/credential`, () => {
      state.stored = false;
      state.changed = true;
      return HttpResponse.json({ provider: "datago", configured: false, masked: null, updated_at: null });
    }),
  );
  return state;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connections?provider=datago"]}>
      <ProviderPage />
    </MemoryRouter>,
  );
}

async function saveAKey() {
  fireEvent.click(await screen.findByRole("button", { name: "사용자 자격 증명 등록" }));
  fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ProviderPage, after a key is saved or deleted", () => {
  it("stops saying the default credential is in use once the user's key is saved", async () => {
    const state = builder();
    renderPage();
    expect((await screen.findAllByText(DEFAULT_NOTE)).length).toBeGreaterThan(0);

    await saveAKey();

    expect(await screen.findByText(/dg••••99/)).toBeInTheDocument();
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);
    expect(screen.getAllByText("API Key 등록됨").length).toBeGreaterThan(0);
    // The key that was typed is nowhere on the screen: not as text, not left in a field.
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/secret/)).not.toBeInTheDocument();
    // Both were asked again after the save: the list and this provider's own key.
    expect(state.summaryCalls).toBeGreaterThanOrEqual(2);
    expect(state.credentialCalls).toBeGreaterThanOrEqual(2);
  });

  it("says so at once, before the reads that confirm the save have answered", async () => {
    // The panel went back to "the default credential is in use" for as long as the two
    // reads after a save took — which is when it is read.
    builder("never answers");
    renderPage();
    expect((await screen.findAllByText(DEFAULT_NOTE)).length).toBeGreaterThan(0);

    await saveAKey();

    await waitFor(() => expect(screen.getAllByText("API Key 등록됨").length).toBeGreaterThan(0));
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "삭제" })).toBeInTheDocument();
  });

  it("keeps saying so when the read that confirms the save fails", async () => {
    const state = builder("fails");
    renderPage();
    expect((await screen.findAllByText(DEFAULT_NOTE)).length).toBeGreaterThan(0);

    await saveAKey();

    await waitFor(() => expect(state.credentialCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getAllByText("API Key 등록됨").length).toBeGreaterThan(0));
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);
    expect(screen.queryByText(READ_FAILED)).not.toBeInTheDocument();
  });

  it("says the default credential is in use again once the user's key is deleted", async () => {
    const state = builder();
    state.stored = true;
    renderPage();
    expect(await screen.findByText(/dg••••99/)).toBeInTheDocument();
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect((await screen.findAllByText(DEFAULT_NOTE)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/dg••••99/)).not.toBeInTheDocument();
  });

  it("shows the key gone at once, and says whose is in use only when the list has been read again", async () => {
    // The list called the provider configured while the user's key was there; whether a
    // default key is left it has not said yet.
    const state = builder("never answers");
    state.stored = true;
    renderPage();
    expect(await screen.findByText(/dg••••99/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(await screen.findByText(LOADING)).toBeInTheDocument();
    expect(screen.queryByText(/dg••••99/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);
  });
});

describe("ProviderPage, after the only key of a provider is deleted", () => {
  // The other way round of #845: with no default key, the provider was "configured" in
  // the list only for the key that has just been deleted.
  it("says a key is needed once the list has been read again", async () => {
    const state = builder("answers", { defaultKey: false });
    state.stored = true;
    renderPage();
    expect(await screen.findByText(/dg••••99/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(await screen.findByText(NEEDS_KEY)).toBeInTheDocument();
    expect(screen.getAllByText(NO_KEY).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);
    expect(screen.queryByText(READY)).not.toBeInTheDocument();
  });

  it("does not say the default credential is in use while the list is being read again", async () => {
    const state = builder("never answers", { defaultKey: false });
    state.stored = true;
    renderPage();
    expect(await screen.findByText(/dg••••99/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(await screen.findByText(LOADING)).toBeInTheDocument();
    expect(screen.queryByText(/dg••••99/)).not.toBeInTheDocument();
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);
    // Nor that the provider is ready: that too is the old line of the list.
    expect(screen.queryByText(READY)).not.toBeInTheDocument();
  });

  it("does not say it when the list could not be read again, however long that lasts", async () => {
    const state = builder("list fails", { defaultKey: false });
    state.stored = true;
    renderPage();
    expect(await screen.findByText(/dg••••99/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(state.summaryCalls).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(READ_FAILED)).toBeInTheDocument();
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);
    expect(screen.queryByText(READY)).not.toBeInTheDocument();
    expect(screen.queryByText(/dg••••99/)).not.toBeInTheDocument();
  });
});

describe("ProviderPage, on a Builder with no credential store", () => {
  // No key of the user's can exist there, so whose key is in use is known.
  function builderWithoutStore(configured: boolean) {
    mswServer.use(
      http.get(`${API_BASE}/providers`, () =>
        HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured }] }),
      ),
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ error: "credential store is not configured" }, { status: 503 }),
      ),
    );
  }

  it("says the default credential is in use when the Builder has one", async () => {
    builderWithoutStore(true);

    renderPage();

    expect(await screen.findByText("자격 증명 저장소가 아직 구성되지 않았습니다")).toBeInTheDocument();
    expect(screen.getAllByText(DEFAULT_NOTE).length).toBeGreaterThan(0);
  });

  it("says a key is missing when it has none", async () => {
    builderWithoutStore(false);

    renderPage();

    expect(await screen.findByText("자격 증명 저장소가 아직 구성되지 않았습니다")).toBeInTheDocument();
    expect(screen.getAllByText(NO_KEY).length).toBeGreaterThan(0);
    expect(screen.getByText(/API Key가 필요할 수 있습니다/)).toBeInTheDocument();
  });
});

describe("ProviderPage, before a provider's own credential state is known", () => {
  it("does not say whose credential is in use", async () => {
    // The list says "configured"; whether by the default key or the user's is not known
    // until this provider's own state has been read.
    mswServer.use(
      http.get(`${API_BASE}/providers`, () =>
        HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured: true }] }),
      ),
      http.get(`${API_BASE}/providers/datago/credential`, async () => {
        await delay("infinite");
        return HttpResponse.json({ configured: true, masked: "dg••••99", updated_at: null });
      }),
    );

    renderPage();

    expect(await screen.findByText(LOADING)).toBeInTheDocument();
    expect(screen.queryAllByText(DEFAULT_NOTE)).toHaveLength(0);
  });
});
