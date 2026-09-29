/**
 * New Build 템플릿 catalog 상태(loading/error/loaded) 테스트 (#Phase2 UI polish).
 *
 * loading/error 상태에서는 아직 Builder catalog와 대조할 수 없으므로 어떤 템플릿도
 * "준비 중"으로 잘못 분류하지 않는다(NewBuildPage.tsx의 isTemplateAvailable/폴백 grid 참고).
 * loaded 상태에서만 실제 catalog 존재 여부로 available/unavailable을 나눈다.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NewBuildPage } from "@/pages/NewBuildPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

function renderWizard() {
  return render(
    <MemoryRouter>
      <NewBuildPage />
    </MemoryRouter>,
  );
}

/** catalog 요청이 이 테스트 동안 절대 resolve되지 않도록 막아, loading 상태를 고정한다. */
function stallCatalog() {
  mswServer.use(http.get(`${API_BASE}/catalog`, () => new Promise(() => {})));
}

function failCatalog() {
  mswServer.use(http.get(`${API_BASE}/catalog`, () => HttpResponse.error()));
}

describe("New Build 템플릿 catalog 상태 (#Phase2 UI polish)", () => {
  it("loading: shows the loading indicator and does not mislabel any template as 준비 중 (unavailable)", async () => {
    stallCatalog();
    renderWizard();

    expect(await screen.findByText("Engine catalog를 불러오는 중입니다...")).toBeInTheDocument();
    // catalog와 아직 대조할 수 없으므로 모든 템플릿(카탈로그 필요 템플릿 포함)이 활성 상태를 유지한다.
    expect(screen.getByRole("button", { name: /인구 통계/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /기준금리 추이/ })).toBeEnabled();
    expect(screen.queryByText(/준비 중인 템플릿/)).not.toBeInTheDocument();
  });

  it("error: shows the catalog fetch failure, not a '준비 중 source' framing", async () => {
    failCatalog();
    renderWizard();

    // builderApi.apiFetch는 네트워크 오류를 지수 백오프로 재시도한다(최대 ~1.5초) — 기본
    // findByRole 타임아웃(1초)보다 길게 기다린다.
    const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(alert).toHaveTextContent("Engine catalog 조회 실패");
    // 조회 실패와 "아직 준비 중인 source"는 다른 상태다 — 실패를 준비 중으로 뭉개지 않는다.
    expect(screen.queryByText(/준비 중인 템플릿/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /인구 통계/ })).toBeEnabled();
  });

  it("loaded — available: a template present in the Builder catalog stays enabled and selectable", async () => {
    // 기본 msw handler는 datago/air_quality만 제공한다(__tests__/msw/handlers.ts).
    renderWizard();

    await waitFor(() => expect(screen.getByRole("button", { name: /대기오염 정보/ })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /대기오염 정보/ }));
    expect(await screen.findByRole("heading", { name: "기본 정보" })).toBeInTheDocument();
  });

  it("loaded — unavailable: templates missing from the Builder catalog move to a separate 준비 중 section, not the primary one", async () => {
    // 기본 msw handler는 datago/air_quality만 제공한다 — bok/kosis 템플릿은 catalog에 없다(F).
    renderWizard();

    const unavailableHeading = await screen.findByText(/준비 중인 템플릿 2개/);
    const unavailableSection = unavailableHeading.closest("div")!;

    const population = screen.getByRole("button", { name: /인구 통계/ });
    const interestRate = screen.getByRole("button", { name: /기준금리 추이/ });
    expect(population).toBeDisabled();
    expect(interestRate).toBeDisabled();
    expect(within(unavailableSection).getByRole("button", { name: /인구 통계/ })).toBe(population);
    expect(within(unavailableSection).getByRole("button", { name: /기준금리 추이/ })).toBe(interestRate);

    // 사용 가능한 air_quality/직접 구성 템플릿은 준비 중 섹션 밖(primary)에 남는다.
    expect(within(unavailableSection).queryByRole("button", { name: /대기오염 정보/ })).not.toBeInTheDocument();
    expect(within(unavailableSection).queryByRole("button", { name: /직접 구성/ })).not.toBeInTheDocument();
  });

  it("'직접 구성' (blank/direct) template stays available in every catalog state", async () => {
    stallCatalog();
    renderWizard();
    expect(screen.getByRole("button", { name: /직접 구성/ })).toBeEnabled();
  });
});
