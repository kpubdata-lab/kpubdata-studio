/**
 * Create Table → Provider 왕복 통합 테스트 (#S-add-data §3, §4).
 *
 * credential이 필요한 Public API Dataset을 선택했는데 provider가 미설정이면
 * Preview까지 가지 않고 Configure 단계에서 미리 막는다. "API 연결하기"는 기존
 * draft persistence를 재사용해 초안을 저장한 뒤 `/provider?provider=…&returnTo=/add`로
 * 이동한다 — provider id/safe return destination만 URL에 싣는다.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddDataPage } from "@/pages/AddDataPage";
import { ProviderPage } from "@/pages/ProviderPage";
import { loadAddDataDraft } from "@/features/add-data/draftStorage";
import { API_BASE } from "@/shared/config/env";
import { forgetAllProviderKeys, holdProviderKey, PROVIDER_KEY_HEADER } from "@/shared/lib/providerKeys";
import { mswServer } from "../vitest.setup";

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/add"]}>
      <Routes>
        <Route path="/add" element={<AddDataPage />} />
        <Route path="/connections" element={<ProviderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

function useAirQualityCatalog() {
  mswServer.use(
    http.get(`${API_BASE}/catalog`, () =>
      HttpResponse.json({
        providers: [
          {
            name: "datago",
            datasets: [
              {
                name: "air_quality",
                title: "대기오염",
                description: null,
                tags: [],
                source_url: null,
                representation: "api_json",
                operations: [],
                query_support: null,
                requires_service_key: true,
                request_parameters: [
                  { name: "sidoName", required: true, description: "조회할 시·도", example: "서울" },
                ],
                application: { required: true, url: "https://www.data.go.kr/data/15073861/openapi.do" },
              },
            ],
          },
        ],
      }),
    ),
  );
}

async function selectAirQuality() {
  fireEvent.click(screen.getByRole("button", { name: /공공 API/ }));
  next();
  await screen.findByText("API 사용 준비");
  // "API 사용 준비" heading은 catalog loading 중에도 렌더된다. 느린 러너(Node 20)에서
  // provider option이 아직 DOM에 없을 때 select value를 바꾸면 무시되어 Dataset select가
  // 계속 disabled로 남는다. sleep 대신 실제 selectable state — datago option이 렌더된
  // 것 — 를 기준으로 기다린다.
  await screen.findByRole("option", { name: "datago" });
  fireEvent.change(screen.getByLabelText(/^제공자/), { target: { value: "datago" } });
  // provider 선택이 반영되면 Dataset select가 열리고 해당 provider의 dataset option이 붙는다.
  await screen.findByRole("option", { name: "대기오염 (air_quality)" });
  fireEvent.change(screen.getByLabelText(/^소스 데이터셋/), { target: { value: "air_quality" } });
  await screen.findByText("이 소스 데이터셋의 요청 파라미터");
}

afterEach(() => {
  vi.unstubAllEnvs();
  forgetAllProviderKeys();
  localStorage.clear();
});

describe("Create Table credential prerequisite (real 모드)", () => {
  it("provider가 미설정이면 Configure에서 막고, API 연결하기로 draft를 보존한 채 Provider로 이동한다", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    useAirQualityCatalog();
    mswServer.use(
      http.get(`${API_BASE}/providers`, () =>
        HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured: false }] }),
      ),
      http.get(`${API_BASE}/providers/datago/credential`, () =>
        HttpResponse.json({ configured: false, masked: null, updated_at: null }),
      ),
    );
    renderApp();
    await selectAirQuality();
    fireEvent.change(screen.getByLabelText(/요청 파라미터/), { target: { value: '{"sidoName":"서울"}' } });

    expect(await screen.findByText("API 연결이 필요합니다")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "API 연결하기" }));

    // Provider 화면으로 이동하고, provider가 자동 선택되며 복귀 안내가 보인다.
    expect(await screen.findByText("테이블 만들기를 계속하려면 API 연결을 완료하세요.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "등록하기" })).toBeInTheDocument();

    // draft가 저장돼 있다 — provider/dataset/사용자가 입력한 요청 파라미터까지 보존된다.
    const saved = loadAddDataDraft();
    expect(saved?.publicApi.provider).toBe("datago");
    expect(saved?.publicApi.dataset).toBe("air_quality");
    expect(saved?.publicApi.sourceParams).toContain("서울");
  });

  it("다중 사용자 배포에서 이 세션에 키를 쥐고 있으면 막지 않는다 (GET /providers 가 키를 싣는다)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    useAirQualityCatalog();
    expect(holdProviderKey("datago", "held-for-this-session")).toBe(true);
    const seen: Array<string | null> = [];
    mswServer.use(
      // Builder in a multi-user deployment: nothing is stored, so `configured` reflects
      // only the keys the request carries (contract 1.90.0).
      http.get(`${API_BASE}/providers`, ({ request }) => {
        const header = request.headers.get(PROVIDER_KEY_HEADER);
        seen.push(header);
        const configured = (header ?? "").split(",").some((item) => item.trim().startsWith("datago="));
        return HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured }] });
      }),
      http.post(`${API_BASE}/preview`, () =>
        HttpResponse.json({ previews: [], transforms: [], diff: null }),
      ),
      http.post(`${API_BASE}/validate`, () => HttpResponse.json({ valid: true, errors: [] })),
    );
    renderApp();
    await selectAirQuality();
    fireEvent.change(screen.getByLabelText(/요청 파라미터/), { target: { value: '{"sidoName":"서울"}' } });

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.every((header) => header === "datago=held-for-this-session")).toBe(true);
    expect(screen.queryByText("API 연결이 필요합니다")).not.toBeInTheDocument();

    next();
    await screen.findByRole("heading", { name: /미리보기 · 검증/ });
    expect(screen.queryByText("API 연결이 필요합니다")).not.toBeInTheDocument();
  });

  it("provider가 configured면 막지 않고 Preview 요청을 진행한다", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    useAirQualityCatalog();
    mswServer.use(
      http.get(`${API_BASE}/providers`, () =>
        HttpResponse.json({ providers: [{ provider: "datago", requires_credential: true, configured: true }] }),
      ),
      http.post(`${API_BASE}/preview`, () =>
        HttpResponse.json({ previews: [], transforms: [], diff: null }),
      ),
      http.post(`${API_BASE}/validate`, () => HttpResponse.json({ valid: true, errors: [] })),
    );
    renderApp();
    await selectAirQuality();
    fireEvent.change(screen.getByLabelText(/요청 파라미터/), { target: { value: '{"sidoName":"서울"}' } });

    await waitFor(() => expect(screen.queryByText("API 연결이 필요합니다")).not.toBeInTheDocument());

    next();
    await screen.findByRole("heading", { name: /미리보기 · 검증/ });
    expect(screen.queryByText("API 연결이 필요합니다")).not.toBeInTheDocument();
  });
});
