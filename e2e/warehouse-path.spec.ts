import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * The warehouse path (#423): Catalog → Tables → a table → SQL, through the menu and
 * the screens' own actions rather than typed URLs. Mock mode: the demo warehouse (#530).
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

  // Table → SQL, bound to that table in the demo warehouse (#530).
  await page.getByRole("link", { name: "쿼리", exact: true }).click();
  await expect(page).toHaveURL(/\/sql\?.*table=air-quality/);
  await expect(page.getByRole("heading", { name: "SQL 작업 공간" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "air-quality.datago__air" })).toHaveAttribute("aria-selected", "true");

  // The demo has no Builder to run SQL: it says so instead of showing made-up rows.
  await page.getByRole("button", { name: /^실행 / }).click();
  await expect(page.getByRole("alert")).toContainText(t("sql.demoWarehouse.needsBuilder"));

  // The breadcrumb names where we are, not the product.
  await expect(page.getByRole("navigation", { name: "현재 위치" })).toContainText("SQL 작업 공간");

  await expectNoPageErrors(errors);
});
