/**
 * SettingsPage Builder API 버전 호환성 점검 테스트 (#75, ADR 0013).
 *
 * Builder가 보고한 api_version이 Studio 통합 표면의 최소 버전과 SemVer 호환되지 않으면
 * (major가 다르거나 최소값 미만) 화면에 경고가 뜨고, 호환되면(같은 major·최소값 이상,
 * 더 높은 additive minor/patch 포함) 경고가 없어야 한다. exact-equality 비교가 아니다.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const version = vi.fn();
const isRealBuilderEnabled = vi.fn(() => true);

vi.mock("@/shared/lib/builderApi", async () => {
  const actual = await vi.importActual<typeof import("@/shared/lib/builderApi")>(
    "@/shared/lib/builderApi",
  );
  return {
    ...actual,
    isRealBuilderEnabled: () => isRealBuilderEnabled(),
    builderApi: { ...actual.builderApi, version: (...args: unknown[]) => version(...args) },
  };
});

const { SettingsPage } = await import("@/pages/SettingsPage");
const { MIN_BUILDER_API_VERSION } = await import("@/shared/lib/builderApi");

afterEach(() => {
  version.mockReset();
  isRealBuilderEnabled.mockReturnValue(true);
});

function renderSettings() {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("SettingsPage version check", () => {
  it("surfaces a warning when the builder major differs (2.0.0)", async () => {
    version.mockResolvedValue({ service: "builder", api_version: "2.0.0" });
    renderSettings();

    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toContain("계약 버전 불일치");
    expect(warning.textContent).toContain("2.0.0");
  });

  it("surfaces a warning when the builder version is below the required minimum (1.17.0)", async () => {
    version.mockResolvedValue({ service: "builder", api_version: "1.17.0" });
    renderSettings();

    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toContain("계약 버전 불일치");
  });

  it("shows no warning at the exact minimum version", async () => {
    version.mockResolvedValue({ service: "builder", api_version: MIN_BUILDER_API_VERSION });
    renderSettings();

    await waitFor(() =>
      expect(
        screen.getByText(new RegExp(`Builder API 버전 ${MIN_BUILDER_API_VERSION}`)),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows no false-incompatible warning for a higher additive minor (1.21.0, current Builder main)", async () => {
    version.mockResolvedValue({ service: "builder", api_version: "1.21.0" });
    renderSettings();

    await waitFor(() =>
      expect(screen.getByText(/Builder API 버전 1\.21\.0/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
