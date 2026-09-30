import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * Core route smoke (#268 checklist: core route smoke tests).
 * Verifies all major screens render titles and have no console errors in mock mode.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

const ROUTES: Array<{ path: string; heading: RegExp | string }> = [
  { path: "/", heading: /작업 현황|테이블로 만드세요/ },
  { path: "/discover", heading: "데이터 탐색" },
  { path: "/refresh-jobs/new", heading: /템플릿 선택|기본 정보/ },
  { path: "/refresh-jobs", heading: /갱신 이력|Refresh History/ },
  { path: "/workspace", heading: "작업대" },
  { path: "/connections", heading: "데이터 제공 기관 연결" },
  { path: "/monitoring", heading: "시스템 모니터링" },
  { path: "/settings", heading: "환경 설정" },
  { path: "/login", heading: /로그인/ },
];

test("핵심 route가 제목을 렌더링하고 console error가 없다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  for (const route of ROUTES) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible({
      timeout: 10_000,
    });
  }

  await expectNoPageErrors(errors);
});

test("Settings에 Provider 자격 증명과 Ask KPubData BYOK가 분리된 영역으로 존재한다 (#301 회귀)", async ({
  page,
}) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/settings");
  await expect(page.getByTestId("settings-provider-credentials")).toBeVisible();
  await expect(page.getByTestId("settings-assistant-byok")).toBeVisible();

  await expectNoPageErrors(errors);
});
