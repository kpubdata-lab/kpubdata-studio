import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Catalog as a comparison table (#529), in a real browser: at 390px the page does not
 * scroll sideways — the table scrolls inside its own region — and a row's start action
 * is reachable from the keyboard. Mock mode, deterministic fixture.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("카탈로그 비교 표는 390px 에서 표 안에서만 가로로 스크롤되고 키보드로 시작할 수 있다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/discover");
  const region = page.getByRole("region", { name: t("discover.table.caption") });
  await expect(region.getByRole("table")).toBeVisible({ timeout: 10_000 });
  await expect(region.getByRole("row", { name: /대기오염 정보/ })).toContainText("datago.air_quality");

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "/discover horizontal overflow at 390px").toBeLessThanOrEqual(2);
  const regionScrolls = await region.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(regionScrolls, "the table scrolls inside its region").toBe(true);

  // Keyboard: the region takes focus (so it can be scrolled), and a row's start action works from it.
  await region.focus();
  await expect(region).toBeFocused();
  const start = region.getByRole("button", { name: `${t("discover.startWith")} — 대기오염 정보` });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/add\?provider=datago&dataset=air_quality/);

  await expectNoPageErrors(errors);
});
