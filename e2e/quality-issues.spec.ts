import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Quality issues across tables (#536), in a real browser: at 390px the page does not
 * scroll sideways — the issues table scrolls inside its own region — and a row's table
 * link reaches Table Detail's Quality tab from the keyboard. Mock mode.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("품질 문제 표는 390px 에서 표 안에서만 가로로 스크롤되고 키보드로 테이블 상세에 간다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/quality");
  const region = page.getByRole("region", { name: t("quality.issues.caption") });
  await expect(region.getByRole("table")).toBeVisible({ timeout: 10_000 });
  const row = region.getByRole("row", { name: /required_column/ });
  await expect(row).toContainText("kma__weather");

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "/quality horizontal overflow at 390px").toBeLessThanOrEqual(2);
  const regionScrolls = await region.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(regionScrolls, "the table scrolls inside its region").toBe(true);

  await region.focus();
  await expect(region).toBeFocused();
  const tableLink = row.getByRole("link", { name: "대기질 통합 데이터" });
  await tableLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tables\/air-quality\?run=air-2026-08-14&source=kma__weather&tab=quality/);

  await expectNoPageErrors(errors);
});
