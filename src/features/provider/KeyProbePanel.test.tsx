/**
 * KeyProbePanel (#410, kpubdata-builder#802).
 *
 * Verifies:
 * - the probe carries the held key in `X-Provider-Key`, sends no body, and puts the key
 *   nowhere else — not in storage, the URL or the console;
 * - each dataset shows its status and what to do next; an action-needed status is a badge
 *   and `available` is plain text;
 * - a status this Studio does not know is shown as sent;
 * - datasets Builder did not reach are named and given no status;
 * - a failure shows a fixed message, never the cause's text;
 * - nothing is requested until the user asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { forgetAllProviderKeys, holdProviderKey } from "@/shared/lib/providerKeys";
import { KeyProbePanel } from "./KeyProbePanel";

const KEY = "dg-KEY-4f9a+/zz==";

interface Seen {
  headers: Array<string | null>;
  bodies: string[];
}

function probed(datasets: unknown[], notProbed: string[] = []) {
  return {
    provider: "datago",
    probed_at: "2026-10-06T09:30:00+00:00",
    complete: notProbed.length === 0,
    datasets,
    not_probed: notProbed,
  };
}

function row(dataset: string, status: string, detail = "") {
  return { dataset, service_id: `svc-${dataset}`, status, detail, http_status: 200 };
}

function mockProbe(body: unknown, seen: Seen, status = 200) {
  mswServer.use(
    http.post(`${API_BASE}/providers/datago/probe`, async ({ request }) => {
      seen.headers.push(request.headers.get("X-Provider-Key"));
      seen.bodies.push(await request.text());
      return HttpResponse.json(body as Record<string, unknown>, { status });
    }),
  );
}

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
let seen: Seen;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  seen = { headers: [], bodies: [] };
  consoleSpies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  expect(holdProviderKey("datago", KEY)).toBe(true);
});

afterEach(() => {
  forgetAllProviderKeys();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function expectKeyNowhere() {
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      expect(store.getItem(store.key(i) ?? "") ?? "").not.toContain(KEY);
    }
  }
  expect(window.location.href).not.toContain(KEY);
  expect(document.body.textContent ?? "").not.toContain(KEY);
  for (const spy of consoleSpies) {
    for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain(KEY);
  }
}

async function check() {
  fireEvent.click(screen.getByRole("button", { name: "확인하기" }));
  await waitFor(() => expect(seen.headers).toHaveLength(1));
}

describe("KeyProbePanel", () => {
  it("asks nothing until the user does", async () => {
    mockProbe(probed([]), seen);

    render(<KeyProbePanel provider="datago" />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen.headers).toEqual([]);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("sends the held key in the header only and shows each dataset's status", async () => {
    mockProbe(probed([row("apt_trade", "available"), row("apt_rent", "application_required")]), seen);

    render(<KeyProbePanel provider="datago" />);
    await check();

    expect(seen.headers).toEqual([`datago=${KEY}`]);
    expect(seen.bodies).toEqual([""]);
    const trade = await screen.findByRole("row", { name: /apt_trade/ });
    expect(within(trade).getByText("사용 가능")).toHaveAttribute("data-status", "normal");
    expect(within(trade).getByText("svc-apt_trade")).toBeInTheDocument();
    const rent = screen.getByRole("row", { name: /apt_rent/ });
    const badge = within(rent).getByText("활용신청 필요");
    expect(badge.closest("[data-status]")).toHaveAttribute("data-status", "actionable");
    expect(within(rent).getByText(/활용신청을 하고/)).toBeInTheDocument();
    expect(screen.getByText(/저장되지 않으며/)).toBeInTheDocument();
    expectKeyNowhere();
  });

  it("shows a status it does not know as Builder sent it", async () => {
    mockProbe(probed([row("apt_trade", "quota_pending_review")]), seen);

    render(<KeyProbePanel provider="datago" />);
    await check();

    const trade = await screen.findByRole("row", { name: /apt_trade/ });
    expect(within(trade).getByText("quota_pending_review")).toHaveAttribute("data-status", "normal");
    expect(within(trade).getByText(/모르는 상태/)).toBeInTheDocument();
  });

  it("names the datasets that were not reached and gives them no status", async () => {
    mockProbe(probed([row("apt_trade", "network_error")], ["apt_rent", "village_fcst"]), seen);

    render(<KeyProbePanel provider="datago" />);
    await check();

    expect(await screen.findByText(/시간 안에 확인하지 못한 소스 데이터셋: apt_rent, village_fcst/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2); // the header and apt_trade
    expect(screen.queryByRole("row", { name: /apt_rent/ })).toBeNull();
  });

  it("says so when the provider has nothing to check", async () => {
    mockProbe(probed([]), seen);

    render(<KeyProbePanel provider="datago" />);
    await check();

    expect(await screen.findByText(/확인할 수 있는 소스 데이터셋이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a fixed message on failure, never the cause", async () => {
    mockProbe({ error: `upstream said: serviceKey=${KEY}`, code: "invalid_request" }, seen, 400);

    render(<KeyProbePanel provider="datago" />);
    await check();

    expect(await screen.findByRole("alert")).toHaveTextContent("확인하지 못했습니다");
    expect(screen.queryByRole("table")).toBeNull();
    expectKeyNowhere();
    // The action is offered again.
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeEnabled();
  });

  it("says how long to wait when Builder refuses a probe asked too soon", async () => {
    mockProbe(
      { error: "this provider was probed a moment ago", code: "probe_rate_limited", retry_after_seconds: 24 },
      seen,
      429,
    );

    render(<KeyProbePanel provider="datago" />);
    await check();

    expect(await screen.findByRole("status")).toHaveTextContent("24초 뒤에 다시 확인하세요");
    // Not a failure, and nothing is retried on its own.
    expect(screen.queryByRole("alert")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen.headers).toHaveLength(1);
  });

  it("asks to wait without a number when Builder gives none, and treats another 429 as a failure", async () => {
    mockProbe({ error: "x", code: "probe_rate_limited" }, seen, 429);
    const { unmount } = render(<KeyProbePanel provider="datago" />);
    await check();
    expect(await screen.findByRole("status")).toHaveTextContent("잠시 후 다시 확인하세요");
    unmount();

    seen.headers.length = 0;
    mockProbe({ error: "too many failed authentication attempts", code: "auth_throttled", retry_after_seconds: 42 }, seen, 429);
    render(<KeyProbePanel provider="datago" />);
    await check();
    expect(await screen.findByRole("alert")).toHaveTextContent("확인하지 못했습니다");
  });

  it("says what it is doing while Builder is still checking (#768)", async () => {
    let finish: () => void = () => {};
    mswServer.use(
      http.post(`${API_BASE}/providers/datago/probe`, async () => {
        seen.headers.push(null);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return HttpResponse.json(probed([row("apt_trade", "available")]));
      }),
    );

    render(<KeyProbePanel provider="datago" />);
    await check();

    expect(screen.getByRole("status")).toHaveTextContent("1분쯤 걸릴 수 있습니다");
    expect(screen.getByRole("button", { name: "확인하는 중…" })).toBeDisabled();
    finish();
    await screen.findByRole("row", { name: /apt_trade/ });
    expect(screen.queryByText(/1분쯤 걸릴 수 있습니다/)).toBeNull();
  });

  it("does not retry: one upstream call per dataset is made per click", async () => {
    mockProbe({ error: "probe unavailable" }, seen, 502);

    render(<KeyProbePanel provider="datago" />);
    await check();
    await screen.findByRole("alert");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(seen.headers).toHaveLength(1);
  });
});
