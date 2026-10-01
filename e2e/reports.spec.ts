import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Reports core flow (#668): create a report from a table and run on `/reports`, land on
 * `/reports/:reportId`, and find it again in the saved list. Mock mode, so the table and
 * run pickers fill from the deterministic fixtures.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("리포트를 만들면 상세 화면으로 이동하고 저장 목록에서 다시 열 수 있다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: t("reports.page.title") }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(t("reports.page.savedEmpty"))).toBeVisible();

  const create = page.getByRole("button", { name: t("reports.page.createCta") });
  await expect(create).toBeEnabled({ timeout: 10_000 });
  await create.click();

  await expect(page).toHaveURL(/\/reports\/[^/]+$/);
  await expect(page.getByRole("heading", { name: t("reportEditor.editTitle") }).first()).toBeVisible({ timeout: 10_000 });
  const detailUrl = page.url();

  // Go back in-app: a fresh page load would run prepareCleanPage's localStorage reset again.
  await page.goBack();
  // Created titles follow the reports.page.createdTitle template.
  const saved = page.getByRole("button", { name: new RegExp(`^${t("reports.page.createdTitle").replace(/\{\{\w+\}\}/g, ".+")}$`) });
  await expect(saved).toBeVisible();
  await saved.click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: t("reportEditor.editTitle") }).first()).toBeVisible();

  await expectNoPageErrors(errors);
});
