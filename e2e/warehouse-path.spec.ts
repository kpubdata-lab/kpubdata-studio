import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * The warehouse path (#423): Catalog → Tables → a table → SQL, through the menu and
 * the screens' own actions rather than typed URLs. Mock mode, deterministic fixture.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("카탈로그에서 테이블을 거쳐 SQL 로 질의한다", async ({ page, isMobile }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "데이터 탐색", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "테이블 만들기" })).toHaveAttribute("href", "/add");

  // Catalog → Tables from the sidebar (opened first on a phone).
  if (isMobile) await page.getByRole("button", { name: "사이드바 열기/닫기" }).click();
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "테이블", exact: true }).click();
  await expect(page).toHaveURL(/\/tables$/);

  // Tables → one table.
  await page.getByText("대기질 통합 데이터").first().click();
  await expect(page).toHaveURL(/\/tables\/air-quality/);

  // Table → SQL, pinned to the run on screen.
  await page.getByRole("link", { name: "쿼리", exact: true }).click();
  await expect(page).toHaveURL(/\/sql\?.*table=air-quality/);
  await expect(page.getByRole("heading", { name: "SQL Workspace" })).toBeVisible();

  const source = page.getByRole("combobox", { name: "Source" });
  if (await source.isVisible()) await source.selectOption("datago__air");
  await page.getByRole("button", { name: /실행/ }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("air-quality@air-2026-08-14 · gold · datago__air", { exact: true })).toBeVisible();

  // The breadcrumb names where we are, not the product.
  await expect(page.getByRole("navigation", { name: "현재 위치" })).toContainText("SQL Workspace");

  await expectNoPageErrors(errors);
});
