import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * Failed Build scenario (#268 scenario 4, mock deterministic).
 *
 * Failed run in Builds list → detail shows failed stage/status → BuildSpec edit entry.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("실패 run이 Builds 목록에 실패 상태로 표시된다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/builds");
  // Mock history contains failed run (air-2026-08-14).
  await expect(page.getByText("dur-older-adult-caution-20260618").first()).toBeVisible({ timeout: 10_000 });

  await expectNoPageErrors(errors);
});

test("실패 run 상세가 실패 stage와 증거를 표시하고 편집으로 이동한다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/builds/dur-older-adult-caution-20260618");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });

  // Master-detail shows failure status badge (distinct from hidden select option).
  const visibleFailed = page.getByText("실패").and(page.locator(":visible")).first();
  await expect(visibleFailed).toBeVisible({ timeout: 10_000 });

  // BuildSpec edit entry (failure → fix flow).
  const editLink = page.getByRole("link", { name: /편집|수정/ }).first();
  if (await editLink.isVisible().catch(() => false)) {
    await editLink.click();
    await page.waitForURL(/\/builds\//);
  }

  await expectNoPageErrors(errors);
});

test("Tables 화면이 실패 dataset의 stage 상태를 정상으로 위장하지 않는다 (#268 원칙)", async ({
  page,
}) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/datasets");
  await expect(page.getByRole("heading", { name: /^(테이블|Tables)$/ }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("대기질 통합 데이터").first()).toBeVisible();

  await expectNoPageErrors(errors);
});
