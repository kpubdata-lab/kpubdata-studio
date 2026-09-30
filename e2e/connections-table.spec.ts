import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Connections as one table (#538), in a real browser: at 390px the page does not scroll
 * sideways — the table scrolls inside its own region — and a provider's credential panel
 * opens from the keyboard. Mock mode, deterministic provider list.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("연결 표는 390px 에서 표 안에서만 가로로 스크롤되고 키보드로 자격 증명 패널을 연다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/connections");
  const region = page.getByRole("region", { name: t("provider.table.caption") });
  await expect(region.getByRole("table")).toBeVisible({ timeout: 10_000 });
  await expect(region.getByRole("row", { name: /datago/ })).toContainText(t("provider.table.authKey"));

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "/connections horizontal overflow at 390px").toBeLessThanOrEqual(2);
  const regionScrolls = await region.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(regionScrolls, "the table scrolls inside its region").toBe(true);

  await region.focus();
  await expect(region).toBeFocused();
  const manage = region.getByRole("button", { name: `${t("provider.table.manage")} — kosis` });
  await manage.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /kosis/ })).toBeVisible();
  await expect(manage).toHaveAttribute("aria-pressed", "true");

  await expectNoPageErrors(errors);
});
