import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Refresh history as one table (#535), in a real browser: at 390px the page does not
 * scroll sideways, a run opens its detail from the keyboard, and the way back keeps the
 * status filter. Mock mode, deterministic history.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("갱신 이력 표는 390px 에서 표 안에서만 스크롤되고 키보드로 상세를 열며 돌아와도 필터가 남는다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/refresh-jobs?status=failed");
  await expect(page.getByRole("heading", { level: 1, name: t("builds.page.title") })).toBeVisible();
  const region = page.getByRole("region", { name: t("builds.table.caption") });
  await expect(region.getByRole("table")).toBeVisible({ timeout: 10_000 });

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "/refresh-jobs horizontal overflow at 390px").toBeLessThanOrEqual(2);
  const regionScrolls = await region.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(regionScrolls, "the table scrolls inside its region").toBe(true);

  const run = region.getByRole("link", { name: "dur-older-adult-caution-20260618" });
  await run.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/refresh-jobs\/dur-older-adult-caution-20260618/);
  await expect(page.getByRole("heading", { level: 1, name: t("builds.detail.title") })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/refresh-jobs\?status=failed$/);
  await expect(page.getByLabel(t("builds.search.filterAria"))).toHaveValue("failed");

  await expectNoPageErrors(errors);
});
