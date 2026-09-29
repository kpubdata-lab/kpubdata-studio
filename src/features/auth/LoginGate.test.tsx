import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { LoginGate } from "./LoginGate";
import { useAuthStore } from "./store";

function LocationDisplay() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

function renderGate(path = "/refresh-jobs?run=abc") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {/* Separate /login as its own route. Without this, LoginGate stays mounted after redirect,
            causing infinite redirect. */}
        <Route path="/login" element={<LocationDisplay />} />
        <Route
          path="*"
          element={
            <LoginGate>
              <div>protected content</div>
            </LoginGate>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  useAuthStore.getState().clear();
  useAuthStore.setState({ oidcStatus: "disabled" });
});

describe("LoginGate", () => {
  it("renders children in mock mode without a token", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    renderGate();
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("preserves a protected deep link in the login redirect", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubEnv("VITE_DEV_BYPASS_AUTH", "false");
    renderGate();
    expect(screen.getByText("/login?returnTo=%2Frefresh-jobs%3Frun%3Dabc")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("renders children when development bypass is explicitly on", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubEnv("VITE_DEV_BYPASS_AUTH", "true");
    renderGate();
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("renders children once OIDC reports authenticated", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    useAuthStore.setState({ oidcStatus: "authenticated" });
    renderGate();
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it.each(["initializing", "unauthenticated", "error"] as const)(
    "redirects to login for OIDC status %s",
    (oidcStatus) => {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      useAuthStore.setState({ oidcStatus });
      renderGate("/settings");
      expect(screen.getByText("/login?returnTo=%2Fsettings")).toBeInTheDocument();
      expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    },
  );
});
