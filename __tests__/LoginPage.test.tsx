/**
 * LoginPage (#263 → #Phase2 UI polish) — 이메일/비밀번호 입력, 로그인 버튼, 계정 발급 안내
 * 링크, 실패 메시지를 확인한다. mock/demo 환경(`VITE_USE_REAL_BUILDER` 미설정)을 가정한다 —
 * 이때만 mock 폼이 보인다(LoginPage.tsx 주석 참고).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "@/pages/LoginPage";
import { useAuthStore } from "@/features/auth/store";

const navigateMock = vi.fn();
const { keycloakLoginMock } = vi.hoisted(() => ({ keycloakLoginMock: vi.fn() }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@/features/auth/keycloak", () => ({
  keycloakLogin: keycloakLoginMock,
}));

function renderLogin(initialEntry = "/login") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  useAuthStore.getState().clear();
  useAuthStore.setState({ oidcStatus: "disabled" });
  navigateMock.mockClear();
  keycloakLoginMock.mockClear();
  vi.unstubAllEnvs();
});

describe("LoginPage", () => {
  it("renders email/password inputs, a login button, and a link to the account-provisioning notice", () => {
    renderLogin();
    expect(screen.getByLabelText("이메일", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "계정 발급 안내" })).toHaveAttribute("href", "/signup");
  });

  it("on success, sets the session and navigates home — the password never reaches the store", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("이메일", { exact: false }), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("비밀번호", { exact: false }), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/", { replace: true }));
    expect(useAuthStore.getState().email).toBe("user@example.com");
    expect(JSON.stringify(useAuthStore.getState())).not.toMatch(/hunter2/);
  });

  it("shows a failure message and does not navigate when the mock provider rejects", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("이메일", { exact: false }), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("비밀번호", { exact: false }), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByText("이메일 또는 비밀번호가 올바르지 않습니다.")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("shows Google and KPubData account entrypoints for an unauthenticated real Builder OIDC login", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubEnv("VITE_OIDC_ISSUER", "https://id.example/realms/kpubdata");
    vi.stubEnv("VITE_OIDC_CLIENT_ID", "studio");
    useAuthStore.setState({ oidcStatus: "unauthenticated" });

    renderLogin("/login?returnTo=%2Frefresh-jobs%3Frun%3Dabc");

    expect(document.querySelector('input[type="email"]')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Google로 계속하기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "KPubData 계정으로 로그인" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));
    expect(keycloakLoginMock).toHaveBeenCalledWith("/refresh-jobs?run=abc", "google");

    fireEvent.click(screen.getByRole("button", { name: "KPubData 계정으로 로그인" }));
    expect(keycloakLoginMock).toHaveBeenCalledWith("/refresh-jobs?run=abc");
  });

  it("returns an authenticated OIDC user to the preserved internal route", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    useAuthStore.setState({ oidcStatus: "authenticated" });

    renderLogin("/login?returnTo=%2Frefresh-jobs%3Frun%3Dabc");

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/refresh-jobs?run=abc", { replace: true }),
    );
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example"]) (
    "falls back to home for authenticated malicious returnTo %s",
    async (returnTo) => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      useAuthStore.setState({ oidcStatus: "authenticated" });

      renderLogin(`/login?${new URLSearchParams({ returnTo }).toString()}`);

      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/", { replace: true }));
    },
  );

  it("shows an initializing notice before exposing the Keycloak CTA", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubEnv("VITE_OIDC_ISSUER", "https://id.example/realms/kpubdata");
    vi.stubEnv("VITE_OIDC_CLIENT_ID", "studio");
    useAuthStore.setState({ oidcStatus: "initializing" });

    renderLogin();

    expect(screen.getByText(/로그인 상태를 확인하는 중/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Google로 계속하기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "KPubData 계정으로 로그인" })).not.toBeInTheDocument();
  });

  it("shows a fail-closed OIDC initialization error", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    useAuthStore.setState({ oidcStatus: "error" });

    renderLogin();

    expect(screen.getByText(/인증 초기화에 실패/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Google로 계속하기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "KPubData 계정으로 로그인" })).not.toBeInTheDocument();
  });

  it("keeps the mock email/password form without real OIDC CTAs", () => {
    renderLogin();

    expect(screen.getByLabelText("이메일", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Google로 계속하기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "KPubData 계정으로 로그인" })).not.toBeInTheDocument();
  });
});
