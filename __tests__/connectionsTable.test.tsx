/**
 * Connections as one table (#538).
 *
 * - One row per provider from GET /providers, columns Provider, Authentication,
 *   Configured, Last test, Action.
 * - Configured reads the summary: ready is plain text, a missing key is a badge (#524).
 * - Last test is `—` — Builder records none (kpubdata-builder#842), nothing is invented.
 * - A key typed into the form is never in the DOM after saving, and the table never
 *   shows key text at all, not even the masked value.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderPage } from "@/pages/ProviderPage";
import { builderApi } from "@/shared/lib/builderApi";

const RAW_KEY = "raw-key-sentinel";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connections"]}>
      <ProviderPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  vi.spyOn(builderApi, "listProviders").mockResolvedValue({
    providers: [
      { provider: "datago", requires_credential: true, configured: false },
      { provider: "kosis", requires_credential: true, configured: true },
      { provider: "law", requires_credential: false, configured: true },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Connections table (#538)", () => {
  it("lists every provider in one table with the five columns", async () => {
    renderPage();

    const table = await screen.findByRole("table", { name: "제공 기관별 인증 방식과 설정 상태" });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["제공 기관", "인증 방식", "설정", "마지막 테스트", "작업"]);
    // Header row + three providers.
    expect(within(table).getAllByRole("row")).toHaveLength(4);

    const datago = within(table).getByRole("row", { name: /datago/ });
    expect(datago).toHaveTextContent("공공데이터포털 (data.go.kr)");
    expect(datago).toHaveTextContent("API Key");
    expect(within(datago).getByText("API Key 미설정").closest("[data-status]")).toHaveAttribute("data-status", "actionable");

    const kosis = within(table).getByRole("row", { name: /kosis/ });
    expect(within(kosis).getByText("연결 준비됨").closest("[data-status]")).toHaveAttribute("data-status", "normal");

    const law = within(table).getByRole("row", { name: /law/ });
    expect(law).toHaveTextContent("인증 불필요");
  });

  it("shows Last test as — because KPubData Builder records none", async () => {
    renderPage();

    const table = await screen.findByRole("table", { name: "제공 기관별 인증 방식과 설정 상태" });
    for (const row of within(table).getAllByRole("row").slice(1)) {
      const lastTest = within(row).getAllByRole("cell")[3];
      expect(lastTest.querySelector('[data-status="missing"]')).not.toBeNull();
    }
    expect(screen.queryByRole("button", { name: /연결 테스트/ })).not.toBeInTheDocument();
  });

  it("opens the credential panel from the row's button", async () => {
    vi.spyOn(builderApi, "getProviderCredential").mockResolvedValue({ configured: false, masked: null, updated_at: null });
    renderPage();

    const manage = await screen.findByRole("button", { name: "자격 증명 관리 — datago" });
    expect(manage).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(manage);

    expect(await screen.findByRole("heading", { name: /자격 증명 \(Credential\) 상태 — datago/ })).toBeInTheDocument();
    expect(manage).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("button", { name: "등록하기" })).toBeInTheDocument();
  });

  it("never puts the raw key in the DOM, and the table shows no key text at all", async () => {
    let saved = false;
    vi.spyOn(builderApi, "getProviderCredential").mockImplementation(async () =>
      saved ? { configured: true, masked: "RA••••ef", updated_at: null } : { configured: false, masked: null, updated_at: null },
    );
    const put = vi.spyOn(builderApi, "putProviderCredential").mockImplementation(async () => {
      saved = true;
      return { configured: true, masked: "RA••••ef", updated_at: null };
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "자격 증명 관리 — datago" }));
    fireEvent.click(await screen.findByRole("button", { name: "등록하기" }));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: RAW_KEY } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("datago", RAW_KEY));
    expect(await screen.findByText("RA••••ef")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(RAW_KEY);
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect(input.value).not.toContain(RAW_KEY);
    }
    const table = screen.getByRole("table", { name: "제공 기관별 인증 방식과 설정 상태" });
    expect(table.textContent).not.toContain("RA••••ef");
  });
});
