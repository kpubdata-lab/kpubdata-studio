/**
 * Settings 통합 테스트 (#301).
 *
 * - 계정/Provider 자격 증명/Ask KPubData BYOK가 분리된 영역으로 존재
 * - Provider 자격 증명 요약은 GET /providers 부울만 사용(원문 키 없음)
 * - 실연동에서 구성 상태 배지·요약 카운트 렌더링, /provider CTA 동작
 * - Ask KPubData BYOK는 메모리 전용 기본값 + opt-in 경고 정책 유지
 * - 가짜 team/project 기능이 표시되지 않음(#292 회귀 금지)
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { SettingsPage } from "@/pages/SettingsPage";
import { builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import { useAuthStore } from "@/features/auth/store";

vi.mock("@/shared/lib/builderApi", async () => {
  const actual = await vi.importActual<typeof import("@/shared/lib/builderApi")>(
    "@/shared/lib/builderApi",
  );
  return {
    ...actual,
    isRealBuilderEnabled: vi.fn(() => false),
    builderApi: {
      version: vi.fn(),
      listProviders: vi.fn(),
    },
  };
});

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/provider" element={<div>PROVIDER_PAGE</div>} />
        <Route path="/kubi" element={<div>ASSISTANT_PAGE</div>} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsPage 통합 (#301)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRealBuilderEnabled).mockReturnValue(false);
    useAuthStore.getState().clear();
    localStorage.clear();
  });

  afterEach(() => {
    useAuthStore.getState().clear();
    localStorage.clear();
  });

  it("계정·Provider 자격 증명·Ask KPubData BYOK가 서로 분리된 영역으로 렌더링된다", async () => {
    renderSettings();

    expect(screen.getByTestId("settings-account")).toBeInTheDocument();
    expect(screen.getByTestId("settings-provider-credentials")).toBeInTheDocument();
    expect(screen.getByTestId("settings-assistant-byok")).toBeInTheDocument();
    expect(
      screen
        .getAllByText("데이터 Provider 자격 증명", { exact: false })
        .some((node) => node.closest('[data-testid="settings-provider-credentials"]') !== null),
    ).toBe(true);
    expect(screen.getByText(/BYOK LLM 키/)).toBeInTheDocument();
  });

  it("mock 모드에서는 Provider 요약이 mock 안내와 /provider CTA를 표시한다", async () => {
    renderSettings();

    expect(
      screen.getByText(/Provider 페이지에서 동작을 시연할 수 있습니다/),
    ).toBeInTheDocument();
    expect(builderApi.listProviders).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Provider 설정에서 관리" })).toHaveAttribute(
      "href",
      "/provider",
    );
  });

  it("실연동에서는 GET /providers 요약(부울)으로 구성 상태를 표시한다", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.version).mockResolvedValue({
      name: "kpubdata-builder",
      api_version: "1.17.0",
    } as never);
    vi.mocked(builderApi.listProviders).mockResolvedValue({
      providers: [
        { provider: "datago", requires_credential: true, configured: true },
        { provider: "kosis", requires_credential: true, configured: false },
        { provider: "seoul", requires_credential: false, configured: false },
      ],
    });

    renderSettings();

    await waitFor(() => {
      expect(
        screen.getByText("자격 증명이 필요한 Provider 2개 중 1개가 구성되었습니다."),
      ).toBeInTheDocument();
    });
    // 배지는 provider명·상태가 분할 텍스트 노드로 렌더링된다 — 목록 기준으로 확인.
    const badgeList = screen.getByLabelText("provider 구성 상태");
    expect(badgeList.textContent).toContain("datago");
    expect(badgeList.textContent).toContain("구성됨");
    expect(badgeList.textContent).toContain("kosis");
    expect(badgeList.textContent).toContain("미구성");
    // 자격 증명이 필요 없는 provider는 요약에 나타나지 않는다.
    expect(badgeList.textContent).not.toContain("seoul");
  });

  it("Provider CTA가 /provider로 이동한다", async () => {
    const locationRef: { current: { pathname: string } | null } = { current: null };
    function LocationProbe() {
      locationRef.current = useLocation();
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/provider" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Provider 설정에서 관리" }));

    await waitFor(() => expect(locationRef.current).not.toBeNull());
    expect(locationRef.current?.pathname).toBe("/provider");
  });

  it("Ask KPubData BYOK는 기본 메모리 전용임을 알리고 opt-in 경고를 유지한다", async () => {
    renderSettings();

    expect(screen.getByText(/메모리에만 보관/)).toBeInTheDocument();
    expect(screen.getByText(/브라우저 저장: 꺼짐/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask KPubData 에서 설정" })).toHaveAttribute("href", "/kubi");
  });

  it("로그인 상태에서 계정 영역이 이메일과 로그아웃을 표시한다", async () => {
    useAuthStore.getState().setSession({
      token: "t",
      email: "user@example.com",
      name: null,
      provider: "mock",
    });

    renderSettings();

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await waitFor(() => {
      expect(useAuthStore.getState().email).toBeNull();
    });
  });

  it("가짜 team/project 기능을 표시하지 않는다 (#292 회귀 금지)", async () => {
    renderSettings();

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("팀");
    expect(pageText).not.toContain("Team");
    expect(pageText).not.toContain("프로젝트 설정");
    expect(pageText).not.toContain("Project");
  });
});
