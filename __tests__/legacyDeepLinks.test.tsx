import { act, render, screen } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { router } from "@/app/router";
import { useUIStore } from "@/shared/hooks/useUIStore";
import ko from "@/shared/i18n/locales/ko.json";

/**
 * App Shell 재구성(#247) 이후에도 실제 `router.tsx` 설정을 통해 레거시 딥링크와 새 IA 라우트가
 * 모두 정상적으로 화면을 렌더하는지 확인한다. 개별 페이지를 직접 렌더하는 다른 테스트와 달리,
 * 여기서는 브라우저 라우터 전체(basename 포함)를 통해 실제 route 매칭을 검증한다.
 *
 * 라우트가 코드 분할되면서(#378) 화면 렌더가 청크 로드 이후로 밀린다 — navigate 직후의
 * 동기 단언은 더 이상 성립하지 않으므로 `findBy*`로 기다린다. 실제 사용자도 같은 순간
 * Suspense 폴백을 본다.
 */
async function navigateTo(path: string) {
  await act(async () => {
    await router.navigate(path);
  });
}

describe("router 딥링크 회귀 (#247)", () => {
  beforeEach(() => {
    // jsdom에는 matchMedia가 없으므로 system 테마 분기를 피하도록 light로 고정한다.
    act(() =>
      useUIStore.setState({
        theme: "light",
        isMobileSidebarOpen: false,
        isAssistantDrawerOpen: false,
      }),
    );
  });

  // The three stand-alone pages were stubs with one button to another screen; the URL now
  // goes to that screen directly (#423, INFORMATION_ARCHITECTURE.md section 3.1).
  it("legacy /validate, /preview, /artifacts still work: each opens the screen that took its function over", async () => {
    render(<RouterProvider router={router} />);

    await navigateTo("/validate?savedSpecId=none#top");
    expect(await screen.findByRole("heading", { level: 1, name: ko.addData.page.title })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/add");
    expect(router.state.location.search).toBe("?savedSpecId=none");
    expect(router.state.location.hash).toBe("#top");

    await navigateTo("/preview");
    expect(await screen.findByRole("heading", { level: 1, name: ko.addData.page.title })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/add");

    await navigateTo("/artifacts");
    expect(await screen.findByRole("heading", { level: 1, name: ko.builds.page.title })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/refresh-jobs");
  });

  it("기존 build 단위 딥링크(:buildId/*)는 그대로 유지된다", async () => {
    render(<RouterProvider router={router} />);

    await navigateTo("/refresh-jobs/abc/run");
    expect(await screen.findByText("상세 진행은 실행 상세에서 확인하세요")).toBeInTheDocument();

    await navigateTo("/refresh-jobs/abc/artifacts");
    expect(await screen.findByText("매니페스트 요약")).toBeInTheDocument();

    await navigateTo("/refresh-jobs/abc/publish");
    expect(await screen.findByRole("heading", { name: "abc 게시" })).toBeInTheDocument();
    expect(screen.getByText("Hugging Face")).toBeInTheDocument();
  });

  it("새 IA route(#247)도 셸 안에서 정상적으로 렌더된다", async () => {
    render(<RouterProvider router={router} />);

    await navigateTo("/discover");
    expect(await screen.findByRole("heading", { name: "데이터 탐색" })).toBeInTheDocument();

    await navigateTo("/quality");
    expect(await screen.findByRole("heading", { name: "품질 센터" })).toBeInTheDocument();

    await navigateTo("/tables/air-quality");
    expect(await screen.findByRole("heading", { name: "대기질 통합 데이터" })).toBeInTheDocument();
  });

  it("존재하지 않는 화면은 관련 없는 기존 화면을 재사용하지 않고 오류 폴백으로 처리한다", async () => {
    render(<RouterProvider router={router} />);

    await navigateTo("/no-such-route-xyz");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("라우트 코드 분할 (#378)", () => {
  beforeEach(() => {
    act(() =>
      useUIStore.setState({
        theme: "light",
        isMobileSidebarOpen: false,
        isAssistantDrawerOpen: false,
      }),
    );
  });

  it("청크를 기다리는 동안 App Shell은 유지되고 폴백이 로딩을 알린다", async () => {
    render(<RouterProvider router={router} />);
    // 이동을 시작하되 완료를 기다리지 않는다 — 폴백이 떠 있는 순간을 잡는다.
    const navigating = router.navigate("/monitoring");

    const fallback = screen.queryByRole("status");
    if (fallback) {
      // Skeleton은 aria-hidden이라 보조기기에는 이 문구만 남는다.
      expect(fallback).toHaveAttribute("aria-busy", "true");
      expect(fallback).toHaveTextContent("화면을 불러오는 중입니다.");
    }

    await act(async () => {
      await navigating;
    });
    expect(await screen.findByRole("heading", { name: "시스템 모니터링" })).toBeInTheDocument();
  });
});
