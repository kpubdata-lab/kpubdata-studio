/**
 * Deleting a stored provider key (#988).
 *
 * - Delete asks first; declining sends no `DELETE /providers/{provider}/credential`.
 * - A confirmed delete sends one request, however many times Delete is pressed while it
 *   is under way, and says what happened: deleted, or that it failed (the key stays).
 * - In a multi-user deployment the key is held for the session only, so forgetting it
 *   never calls the persistent delete.
 * - No key value reaches the console.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mswServer } from "../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { resetVersionCheck } from "@/features/version-check/store";
import { forgetAllProviderKeys, holdProviderKey, isProviderKeyHeld } from "@/shared/lib/providerKeys";
import { ProviderPage } from "@/pages/ProviderPage";

const MASKED = "dg••••99";
const SESSION_KEY = "dg-SESSION-KEY-7f3a";

interface Seen {
  deletes: number;
}

function mockBuilder(seen: Seen, options: { publishCredential?: "request" | "stored_or_server" } = {}) {
  let stored = true;
  mswServer.use(
    http.get(`${API_BASE}/version`, () =>
      HttpResponse.json({
        service: "kpubdata-builder",
        api_version: "1.69.0",
        publish_credential: options.publishCredential ?? "stored_or_server",
      }),
    ),
    http.get(`${API_BASE}/providers`, () =>
      HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured: stored }] }),
    ),
    http.get(`${API_BASE}/providers/datago/credential`, () =>
      HttpResponse.json(
        stored
          ? { configured: true, masked: MASKED, updated_at: "2026-10-01T00:00:00+00:00" }
          : { configured: false, masked: null, updated_at: null },
      ),
    ),
  );
  return {
    deleteAnswers(answer: () => Promise<Response> | Response) {
      mswServer.use(
        http.delete(`${API_BASE}/providers/datago/credential`, async () => {
          seen.deletes += 1;
          const response = await answer();
          if (response.ok) stored = false;
          return response;
        }),
      );
    },
  };
}

const deleted = () =>
  HttpResponse.json({ provider: "datago", configured: false, masked: null, updated_at: null });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connections?provider=datago"]}>
      <ProviderPage />
    </MemoryRouter>,
  );
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  resetVersionCheck();
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
});

afterEach(() => {
  for (const spy of consoleSpies) {
    for (const args of spy.mock.calls) {
      expect(JSON.stringify(args)).not.toContain(MASKED);
      expect(JSON.stringify(args)).not.toContain(SESSION_KEY);
    }
  }
  forgetAllProviderKeys();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ProviderPage — deleting a stored key (#988)", () => {
  it("asks before deleting, and a declined confirmation sends nothing and keeps the key", async () => {
    const seen: Seen = { deletes: 0 };
    mockBuilder(seen).deleteAnswers(deleted);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    expect(await screen.findByText(MASKED)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0]?.[0])).toContain("datago");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(seen.deletes).toBe(0);
    expect(screen.getByText(MASKED)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /삭제/ })).not.toBeInTheDocument();
  });

  it("sends one DELETE for a confirmed delete however often Delete is pressed, and says it is deleted", async () => {
    const seen: Seen = { deletes: 0 };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockBuilder(seen).deleteAnswers(async () => {
      await gate;
      return deleted();
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    expect(await screen.findByText(MASKED)).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "삭제" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(seen.deletes).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /삭제/ }));
    expect(screen.getByRole("button", { name: /삭제/ })).toBeDisabled();

    release();
    expect(await screen.findByText("datago 자격 증명을 삭제했습니다.")).toBeInTheDocument();
    expect(screen.getByText("datago 자격 증명을 삭제했습니다.").closest("[role=status]")).not.toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(seen.deletes).toBe(1);
    expect(screen.queryByText(MASKED)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says a failed delete failed, keeps the key, and lets the user try again", async () => {
    const seen: Seen = { deletes: 0 };
    const builder = mockBuilder(seen);
    builder.deleteAnswers(() => HttpResponse.json({ error: "boom" }, { status: 500 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    expect(await screen.findByText(MASKED)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("자격 증명 삭제에 실패했습니다");
    // A write is sent once (#999): a 500 is not retried behind the user's back.
    expect(seen.deletes).toBe(1);
    expect(screen.getByText(MASKED)).toBeInTheDocument();
    expect(screen.queryByText("datago 자격 증명을 삭제했습니다.")).not.toBeInTheDocument();

    builder.deleteAnswers(deleted);
    const again = screen.getByRole("button", { name: "삭제" });
    expect(again).toBeEnabled();
    fireEvent.click(again);
    expect(await screen.findByText("datago 자격 증명을 삭제했습니다.")).toBeInTheDocument();
    expect(seen.deletes).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("forgets a session-held key in a multi-user deployment without the persistent delete", async () => {
    const seen: Seen = { deletes: 0 };
    mockBuilder(seen, { publishCredential: "request" }).deleteAnswers(deleted);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    holdProviderKey("datago", SESSION_KEY);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "키 지우기" }));

    await waitFor(() => expect(isProviderKeyHeld("datago")).toBe(false));
    expect(seen.deletes).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
  });
});
