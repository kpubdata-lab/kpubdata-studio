/**
 * ProviderPage in a multi-user Builder (#652, kpubdata-builder#683, contract 1.56.0).
 *
 * Verifies:
 * - `publish_credential: request` (multi-user) offers "use for this session", never a
 *   stored save: no PUT is sent, and the key is held in memory only — not in
 *   localStorage, sessionStorage, the URL or the console;
 * - the Test action then carries the key in `X-Provider-Key`;
 * - from a Builder that does not say, PUT's 403 `credential_storage_disabled` gets its own
 *   message (not the 503 "store not configured" one) and the session action as next step;
 * - a single-user Builder still saves with PUT and sends no `X-Provider-Key`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { forgetAllProviderKeys } from "@/shared/lib/providerKeys";
import { resetVersionCheck } from "@/features/version-check/store";
import { ApiError } from "@/shared/lib/builderApi";
import { ProviderPage, isCredentialStorageDisabled } from "./ProviderPage";

const KEY = "dg-KEY-4f9a+/zz==";

const PROVIDERS = {
  providers: [{ provider: "datago", requires_credential: true, configured: false }],
};

interface Seen {
  puts: number;
  testHeaders: Array<string | null>;
}

function mockBuilder(publishCredential: "request" | "stored_or_server" | undefined, seen: Seen) {
  mswServer.use(
    http.get(`${API_BASE}/version`, () =>
      HttpResponse.json({ service: "kpubdata-builder", api_version: "1.69.0", publish_credential: publishCredential }),
    ),
    http.get(`${API_BASE}/providers`, () => HttpResponse.json(PROVIDERS)),
    http.get(`${API_BASE}/providers/datago/credential`, () =>
      HttpResponse.json({ configured: false, masked: null, updated_at: null }),
    ),
    http.post(`${API_BASE}/providers/datago/test`, ({ request }) => {
      seen.testHeaders.push(request.headers.get("X-Provider-Key"));
      return HttpResponse.json({
        provider: "datago",
        status: "connected",
        configured: true,
        latency_ms: 3,
        checked_at: "2026-10-01T00:00:00+00:00",
      });
    }),
  );
}

function renderProviders() {
  return render(
    <MemoryRouter initialEntries={["/connections?provider=datago&returnTo=%2Fadd"]}>
      <ProviderPage />
    </MemoryRouter>,
  );
}

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;

function expectKeyNowhere(spies: Array<ReturnType<typeof vi.spyOn>>) {
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      expect(store.getItem(store.key(i) ?? "") ?? "").not.toContain(KEY);
    }
  }
  expect(window.location.href).not.toContain(KEY);
  for (const spy of spies) {
    for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain(KEY);
  }
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
let setItem: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  resetVersionCheck();
  consoleSpies = consoleMethods.map((method) => vi.spyOn(console, method));
  setItem = vi.spyOn(Storage.prototype, "setItem");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  forgetAllProviderKeys();
  resetVersionCheck();
});

describe("ProviderPage multi-user credential mode (#652)", () => {
  it("offers a session-only key instead of saving, and Test sends it in X-Provider-Key", async () => {
    const seen: Seen = { puts: 0, testHeaders: [] };
    mockBuilder("request", seen);
    mswServer.use(
      http.put(`${API_BASE}/providers/datago/credential`, () => {
        seen.puts += 1;
        return HttpResponse.json({ error: "x", code: "credential_storage_disabled" }, { status: 403 });
      }),
    );
    renderProviders();

    expect(await screen.findByText("이 KPubData Builder는 provider 키를 저장하지 않습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록하기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이번 세션에 쓸 키 입력" }));
    fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "이번 세션에 사용" }));

    expect(await screen.findByText(/이번 세션 동안 보관 중입니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "데이터 설정으로 돌아가기" })).toHaveAttribute("href", "/add");
    // The typed key is not echoed back anywhere on the page.
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(seen.puts).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "테스트 — datago" }));
    await waitFor(() => expect(seen.testHeaders).toEqual([`datago=${KEY}`]));

    expect(setItem).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining(KEY));
    expectKeyNowhere(consoleSpies);

    // Forgetting the key stops sending it.
    fireEvent.click(screen.getByRole("button", { name: "키 지우기" }));
    fireEvent.click(screen.getByRole("button", { name: "테스트 — datago" }));
    await waitFor(() => expect(seen.testHeaders).toHaveLength(2));
    expect(seen.testHeaders[1]).toBeNull();
  });

  it("from a Builder that does not say, 403 credential_storage_disabled gets its own message and the session action", async () => {
    const seen: Seen = { puts: 0, testHeaders: [] };
    mockBuilder(undefined, seen);
    mswServer.use(
      http.put(`${API_BASE}/providers/datago/credential`, () => {
        seen.puts += 1;
        return HttpResponse.json(
          {
            error: "this deployment does not store provider keys; send the key with each request in the X-Provider-Key header",
            code: "credential_storage_disabled",
          },
          { status: 403 },
        );
      }),
    );
    renderProviders();

    fireEvent.click(await screen.findByRole("button", { name: "등록하기" }));
    fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText(/provider 키를 저장하지 않는 다중 사용자 배포라서 저장되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/master key/)).not.toBeInTheDocument();
    expect(screen.queryByText("Credential 저장에 실패했습니다")).not.toBeInTheDocument();
    expect(seen.puts).toBe(1);

    // Next action: the typed key is still in the form, one click from this session's use.
    fireEvent.click(screen.getByRole("button", { name: "이번 세션에 사용" }));
    expect(await screen.findByText(/이번 세션 동안 보관 중입니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "테스트 — datago" }));
    await waitFor(() => expect(seen.testHeaders).toEqual([`datago=${KEY}`]));
    expect(seen.puts).toBe(1);
    expectKeyNowhere(consoleSpies);
  });

  it("a key the header cannot carry is refused, not held", async () => {
    const seen: Seen = { puts: 0, testHeaders: [] };
    mockBuilder("request", seen);
    renderProviders();

    fireEvent.click(await screen.findByRole("button", { name: "이번 세션에 쓸 키 입력" }));
    fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), { target: { value: "a,b" } });
    fireEvent.click(screen.getByRole("button", { name: "이번 세션에 사용" }));

    expect(await screen.findByText(/입력한 키를 그대로 보낼 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/이번 세션 동안 보관 중입니다/)).not.toBeInTheDocument();
  });

  it("single-user Builder keeps the stored save flow and sends no X-Provider-Key", async () => {
    const seen: Seen = { puts: 0, testHeaders: [] };
    const bodies: unknown[] = [];
    mockBuilder("stored_or_server", seen);
    mswServer.use(
      http.put(`${API_BASE}/providers/datago/credential`, async ({ request }) => {
        seen.puts += 1;
        bodies.push(await request.json());
        return HttpResponse.json({ provider: "datago", configured: true, masked: "dg••••==", updated_at: null });
      }),
    );
    renderProviders();

    fireEvent.click(await screen.findByRole("button", { name: "등록하기" }));
    expect(screen.queryByText("이 KPubData Builder는 provider 키를 저장하지 않습니다")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(seen.puts).toBe(1));
    expect(bodies).toEqual([{ credential: KEY }]);

    fireEvent.click(screen.getByRole("button", { name: "테스트 — datago" }));
    await waitFor(() => expect(seen.testHeaders).toEqual([null]));
  });
});

describe("isCredentialStorageDisabled", () => {
  it("matches only Builder's 403 credential_storage_disabled", () => {
    expect(isCredentialStorageDisabled(new ApiError(403, "x", { code: "credential_storage_disabled" }))).toBe(true);
    expect(isCredentialStorageDisabled(new ApiError(403, "x", { code: "provider_credential_required" }))).toBe(false);
    expect(isCredentialStorageDisabled(new ApiError(503, "x", { code: "credential_storage_disabled" }))).toBe(false);
    expect(isCredentialStorageDisabled(new Error("x"))).toBe(false);
  });
});
