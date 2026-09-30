/**
 * ProviderPage credential state and race tests.
 *
 * Verifies:
 * - configured / not-configured credential states each render exactly
 * - GET /providers/{p}/credential 503 (operator has no master key) is shown
 *   as "store not configured" — never blended with "not registered yet" or
 *   ordinary errors
 * - Switching from A to B while A's fetch is pending: A's late response does
 *   not pollute the B panel
 * - A late metadata refresh after A's credential mutation (save) also never
 *   overwrites B
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse, delay } from "msw";
import { mswServer } from "../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { ProviderPage, isCredentialStoreUnavailable, isSafeReturnTo } from "./ProviderPage";
import { ApiError } from "@/shared/lib/builderApi";

const PROVIDERS = {
  providers: [
    { provider: "datago", requires_credential: true, configured: false },
    { provider: "kosis", requires_credential: true, configured: false },
  ],
};

function renderProviders(initialEntry = "/connections") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ProviderPage />
    </MemoryRouter>,
  );
}

async function selectProvider(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `자격 증명 관리 — ${name}` }));
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  mswServer.use(http.get(`${API_BASE}/providers`, () => HttpResponse.json(PROVIDERS)));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ProviderPage credential 상태", () => {
  it("configured=true면 마스킹 값과 삭제 버튼을 보여준다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ configured: true, masked: "dg••••99", updated_at: "2026-08-15T09:25:00+00:00" }),
      ),
    );
    renderProviders();
    await selectProvider("datago");

    expect(await screen.findByText(/dg••••99/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeInTheDocument();
  });

  it("configured=false면 등록 CTA를 보여주고 마스킹 값/삭제 버튼은 없다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ configured: false, masked: null, updated_at: null }),
      ),
    );
    renderProviders();
    await selectProvider("datago");

    expect(await screen.findByRole("button", { name: "등록하기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
  });

  it("credential GET 503은 '저장소 미구성'으로 구분해서 표시한다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ error: "credential store is not configured" }, { status: 503 }),
      ),
    );
    renderProviders();
    await selectProvider("datago");

    expect(
      await screen.findByText("자격 증명 저장소가 아직 구성되지 않았습니다"),
    ).toBeInTheDocument();
    // Not mistakable for an ordinary error message or register/delete controls.
    expect(screen.queryByText("자격 증명 상태를 불러오지 못했습니다")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "등록하기" })).not.toBeInTheDocument();
  });

  it("unrelated credential GET 503은 일반 조회 실패로 표시한다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ error: "upstream temporarily unavailable" }, { status: 503 }),
      ),
    );
    renderProviders();
    await selectProvider("datago");

    expect(await screen.findByText("자격 증명 상태를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("자격 증명 저장소가 아직 구성되지 않았습니다")).not.toBeInTheDocument();
  });

  it("unrelated credential PUT/DELETE 503은 master key 안내 대신 일반 실패로 표시한다", async () => {
    let configured = false;
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ configured, masked: configured ? "dg••••99" : null, updated_at: null }),
      ),
      http.put(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ error: "upstream temporarily unavailable" }, { status: 503 }),
      ),
      http.delete(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ error: "upstream temporarily unavailable" }, { status: 503 }),
      ),
    );
    renderProviders();
    await selectProvider("datago");

    fireEvent.click(await screen.findByRole("button", { name: "등록하기" }));
    fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("Credential 저장에 실패했습니다")).toBeInTheDocument();
    expect(screen.queryByText(/master key/)).not.toBeInTheDocument();

    configured = true;
    fireEvent.click(screen.getByRole("button", { name: "자격 증명 관리 — datago" }));
    expect(await screen.findByRole("button", { name: "삭제" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("Credential 삭제에 실패했습니다")).toBeInTheDocument();
    expect(screen.queryByText(/master key/)).not.toBeInTheDocument();
  });
});

describe("ProviderPage 연결 상태 표현 (credential readiness)", () => {
  it("generic live probe(연결 테스트) 대신 credential readiness만 노출한다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers`, () => HttpResponse.json({
        providers: [{ provider: "datago", requires_credential: true, configured: true }],
      })),
      http.get(`${API_BASE}/providers/datago/credential`, () => HttpResponse.json({
        configured: true,
        masked: "dg••••99",
        updated_at: "2026-09-01T00:00:00+00:00",
      })),
    );
    renderProviders();
    await selectProvider("datago");

    expect(await screen.findByText(/dg••••99/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /자격 증명 \(Credential\) 상태 — datago/ })).toBeInTheDocument();
    // With a user-saved credential: "API Key registered" + Preview guidance.
    expect(screen.getAllByText("API Key 등록됨").length).toBeGreaterThan(0);
    expect(screen.getByText(/실제 소스 데이터셋 API 사용 가능 여부는 Add Data의 Preview/)).toBeInTheDocument();
    // There is no generic probe UI.
    expect(screen.queryByRole("button", { name: "연결 테스트" })).not.toBeInTheDocument();
    expect(screen.queryByText("연결 / 실제 API 확인")).not.toBeInTheDocument();
  });

  it("credential 미설정이면 목록·상세 모두 'API Key 미설정'으로 표시한다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers`, () => HttpResponse.json({
        providers: [{ provider: "datago", requires_credential: true, configured: false }],
      })),
      http.get(`${API_BASE}/providers/datago/credential`, () => HttpResponse.json({
        configured: false,
        masked: null,
        updated_at: null,
      })),
    );
    renderProviders();
    // List badges — shown by summary criteria even before selecting a provider.
    expect(await screen.findAllByText("API Key 미설정")).not.toHaveLength(0);
    await selectProvider("datago");
    expect(await screen.findByRole("button", { name: "등록하기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "연결 테스트" })).not.toBeInTheDocument();
  });
});

describe("isCredentialStoreUnavailable", () => {
  it("정확한 Builder 503 payload만 저장소 미구성으로 판별한다", () => {
    expect(
      isCredentialStoreUnavailable(
        new ApiError(503, "Service Unavailable", { error: "credential store is not configured" }),
      ),
    ).toBe(true);
    expect(isCredentialStoreUnavailable(new ApiError(503, "Service Unavailable", { error: "upstream down" }))).toBe(false);
    expect(isCredentialStoreUnavailable(new ApiError(500, "boom", { error: "credential store is not configured" }))).toBe(false);
  });
});

describe("ProviderPage provider 전환 race", () => {
  it("A 조회가 pending인 동안 B로 전환하면 A의 늦은 응답이 B 패널을 덮지 않는다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, async () => {
        await delay(250);
        return HttpResponse.json({
          configured: true,
          masked: "DATAGO-STALE",
          updated_at: "2026-08-15T09:25:00+00:00",
        });
      }),
      http.get(`${API_BASE}/providers/kosis/credential`, () =>
        HttpResponse.json({ configured: false, masked: null, updated_at: null }),
      ),
    );
    renderProviders();

    await selectProvider("datago");
    await selectProvider("kosis");

    // kosis shows its own state (unregistered).
    expect(await screen.findByRole("button", { name: "등록하기" })).toBeInTheDocument();

    // Gives datago's late response time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.queryByText(/DATAGO-STALE/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "등록하기" })).toBeInTheDocument();
  });

  it("A credential 저장 완료 후의 늦은 metadata refresh도 B 패널을 덮지 않는다", async () => {
    let datagoStored = false;
    let datagoCredentialGets = 0;
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () => {
        datagoCredentialGets += 1;
        return HttpResponse.json(
          datagoStored
            ? { configured: true, masked: "DATAGO-NEWKEY", updated_at: "2026-09-01T00:00:00+00:00" }
            : { configured: false, masked: null, updated_at: null },
        );
      }),
      http.put(`${API_BASE}/providers/datago/credential`, async () => {
        await delay(250);
        datagoStored = true;
        return HttpResponse.json({
          provider: "datago",
          configured: true,
          masked: "DATAGO-NEWKEY",
          updated_at: "2026-09-01T00:00:00+00:00",
        });
      }),
      http.get(`${API_BASE}/providers/kosis/credential`, () =>
        HttpResponse.json({ configured: false, masked: null, updated_at: null }),
      ),
    );
    renderProviders();

    await selectProvider("datago");
    fireEvent.click(await screen.findByRole("button", { name: "등록하기" }));
    fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), {
      target: { value: "typed-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    // Switch to B while the save is in flight.
    await selectProvider("kosis");
    expect(await screen.findByRole("button", { name: "등록하기" })).toBeInTheDocument();

    // After leaving for B, no new stale A metadata refresh is started.
    await waitFor(() => expect(datagoStored).toBe(true));
    expect(datagoCredentialGets).toBe(1);

    expect(screen.queryByText(/DATAGO-NEWKEY/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "등록하기" })).toBeInTheDocument();
  });

  it("A mutation 완료가 pending B credential GET을 stale 처리하지 않는다", async () => {
    let resolveKosis: ((response: Response) => void) | undefined;
    let resolvePut: ((response: Response) => void) | undefined;
    let datagoCredentialGets = 0;
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () => {
        datagoCredentialGets += 1;
        return HttpResponse.json({ configured: false, masked: null, updated_at: null });
      }),
      http.put(`${API_BASE}/providers/datago/credential`, () =>
        new Promise<Response>((resolve) => {
          resolvePut = resolve;
        }),
      ),
      http.get(`${API_BASE}/providers/kosis/credential`, () =>
        new Promise<Response>((resolve) => {
          resolveKosis = resolve;
        }),
      ),
    );
    renderProviders();

    await selectProvider("datago");
    fireEvent.click(await screen.findByRole("button", { name: "등록하기" }));
    fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await selectProvider("kosis");

    await waitFor(() => expect(resolveKosis).toBeDefined());
    await waitFor(() => expect(resolvePut).toBeDefined());
    resolvePut?.(HttpResponse.json({ provider: "datago", configured: true, masked: "DG", updated_at: null }));
    // A's stale mutation completion does not increase B's request-generation.
    await waitFor(() => expect(datagoCredentialGets).toBe(1));
    expect(datagoCredentialGets).toBe(1);
    resolveKosis?.(HttpResponse.json({ configured: false, masked: null, updated_at: null }));

    expect(await screen.findByRole("button", { name: "등록하기" })).toBeInTheDocument();
  });
});

describe("ProviderPage Add Data 왕복 (#S-add-data §4)", () => {
  it("?provider=로 넘어오면 목록 로딩 후 해당 provider를 자동 선택한다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ configured: false, masked: null, updated_at: null }),
      ),
    );
    renderProviders("/connections?provider=datago&returnTo=%2Fadd");

    expect(await screen.findByRole("button", { name: "등록하기" })).toBeInTheDocument();
  });

  it("returnTo가 있으면 Add Data 복귀 안내 배너를 보여준다", async () => {
    renderProviders("/connections?provider=datago&returnTo=%2Fadd");
    expect(
      await screen.findByText("데이터 추가를 계속하려면 API 연결을 완료하세요."),
    ).toBeInTheDocument();
  });

  it("returnTo가 없으면 복귀 안내 배너를 보여주지 않는다", async () => {
    renderProviders();
    await selectProvider("datago");
    expect(
      screen.queryByText("데이터 추가를 계속하려면 API 연결을 완료하세요."),
    ).not.toBeInTheDocument();
  });

  it("credential을 저장하면 returnTo로 돌아가는 CTA를 보여준다", async () => {
    let configured = false;
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json(
          configured
            ? { configured: true, masked: "dg••••99", updated_at: "2026-09-02T00:00:00+00:00" }
            : { configured: false, masked: null, updated_at: null },
        ),
      ),
      http.put(`${API_BASE}/providers/datago/credential`, () => {
        configured = true;
        return HttpResponse.json({ provider: "datago", configured: true, masked: "dg••••99", updated_at: null });
      }),
    );
    renderProviders("/connections?provider=datago&returnTo=%2Fadd");

    fireEvent.click(await screen.findByRole("button", { name: "등록하기" }));
    fireEvent.change(screen.getByPlaceholderText("API Key를 입력하세요"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const cta = await screen.findByRole("link", { name: "데이터 설정으로 돌아가기" });
    expect(cta).toHaveAttribute("href", "/add");
  });

  it("저장 전에는 돌아가기 CTA를 보여주지 않는다", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ configured: true, masked: "dg••••99", updated_at: null }),
      ),
    );
    renderProviders("/connections?provider=datago&returnTo=%2Fadd");
    await screen.findByText(/dg••••99/);
    expect(screen.queryByRole("link", { name: "데이터 설정으로 돌아가기" })).not.toBeInTheDocument();
  });
});

describe("ProviderPage last test and Test action (kpubdata-builder#842)", () => {
  function lastTestCell(provider: string) {
    const row = screen.getAllByRole("row").find((candidate) => candidate.textContent?.includes(provider));
    if (!row) throw new Error(`no row for ${provider}`);
    return row.querySelectorAll("td")[3] as HTMLElement;
  }

  it("shows last_test per provider; not_testable is quiet text, only failed is a badge", async () => {
    mswServer.use(
      http.get(`${API_BASE}/providers`, () =>
        HttpResponse.json({
          providers: [
            {
              provider: "datago",
              requires_credential: true,
              configured: true,
              last_test: {
                status: "connected",
                checked_at: "2026-09-01T00:00:00+00:00",
                error_category: null,
                response_code: null,
                dataset: "datago.sample",
              },
            },
            {
              provider: "kosis",
              requires_credential: true,
              configured: true,
              last_test: {
                status: "not_testable",
                checked_at: "2026-09-01T00:00:00+00:00",
                error_category: null,
                response_code: null,
                dataset: null,
              },
            },
            {
              provider: "g2b",
              requires_credential: true,
              configured: true,
              last_test: {
                status: "failed",
                checked_at: "2026-09-01T00:00:00+00:00",
                error_category: "auth",
                response_code: 401,
                dataset: null,
              },
            },
            { provider: "seoul", requires_credential: true, configured: true, last_test: null },
            { provider: "localdata", requires_credential: false, configured: true },
          ],
        }),
      ),
    );
    renderProviders();
    await screen.findByText("datago.sample", { exact: false });

    expect(lastTestCell("datago")).toHaveTextContent("연결됨");
    const notTestable = lastTestCell("kosis");
    expect(notTestable).toHaveTextContent("시험 불가");
    expect(notTestable.querySelector('[data-status="actionable"]')).toBeNull();
    const failed = lastTestCell("g2b");
    expect(failed.querySelector('[data-status="actionable"][data-tone="failure"]')).toHaveTextContent("연결 오류");
    expect(lastTestCell("seoul")).toHaveTextContent("테스트 기록 없음");
    // A Builder that does not send last_test: a dash, never a guess.
    expect(lastTestCell("localdata").querySelector('[data-status="missing"]')).not.toBeNull();
  });

  it("Test calls POST /providers/{p}/test and shows the result as that row's last test", async () => {
    let calls = 0;
    mswServer.use(
      http.post(`${API_BASE}/providers/kosis/test`, () => {
        calls += 1;
        return HttpResponse.json({
          provider: "kosis",
          status: "not_testable",
          configured: false,
          latency_ms: 3,
          checked_at: "2026-09-02T00:00:00+00:00",
        });
      }),
    );
    renderProviders();
    fireEvent.click(await screen.findByRole("button", { name: "테스트 — kosis" }));

    await waitFor(() => expect(lastTestCell("kosis")).toHaveTextContent("시험 불가"));
    expect(calls).toBe(1);
    expect(lastTestCell("kosis").querySelector('[data-status="actionable"]')).toBeNull();
  });

  it("a Test request that fails is an error on the page, not a key failure in the row", async () => {
    mswServer.use(
      http.post(`${API_BASE}/providers/datago/test`, () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    renderProviders();
    fireEvent.click(await screen.findByRole("button", { name: "테스트 — datago" }));

    expect(await screen.findByText("datago 연결 테스트를 실행하지 못했습니다")).toBeInTheDocument();
    expect(lastTestCell("datago").querySelector('[data-status="actionable"]')).toBeNull();
  });
});

describe("isSafeReturnTo — open redirect 방지", () => {
  it("내부 절대 경로만 안전으로 판정한다", () => {
    expect(isSafeReturnTo("/add")).toBe(true);
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo("")).toBe(false);
    expect(isSafeReturnTo("add")).toBe(false);
    expect(isSafeReturnTo("//evil.com")).toBe(false);
    expect(isSafeReturnTo("https://evil.com")).toBe(false);
    expect(isSafeReturnTo("/\\evil.com")).toBe(false);
  });
});
