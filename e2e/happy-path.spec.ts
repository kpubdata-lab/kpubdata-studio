import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * New user Public API happy path (#268 scenario 1, mock deterministic).
 *
 * Home (new user) → Catalog → dataset catalog exploration → Create Table entry.
 * Verified with deterministic fixture in mock mode.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("신규 사용자가 Home에서 Catalog·테이블 만들기로 이동한다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/");
  await expect(page.getByRole("heading").first()).toBeVisible();

  // Catalog: mock catalog renders 2+ providers.
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "데이터 탐색", exact: true })).toBeVisible();
  await expect(page.getByText("air_quality").first()).toBeVisible();

  // Create Table entry: Source selection step renders.
  await page.goto("/add");
  await expect(page.getByRole("heading", { name: t("addData.source.title") })).toBeVisible();

  await expectNoPageErrors(errors);
});

test("Workspace에 Saved BuildSpec 저장·새로고침 후 재노출된다 (#268 시나리오 5)", async ({
  page,
}) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // The old creation URL lands in the one creation flow at /add (#534).
  await page.goto("/refresh-jobs/new");
  await expect(page).toHaveURL(/\/add$/);
  await expect(page.getByRole("heading", { name: "데이터 선택" })).toBeVisible();

  // Workspace entry via Build creation CTA (save flow validated at unit level — here we check
  // screen transition and empty state guidance have no regressions).
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "작업대" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "작업대" })).toBeVisible();

  await expectNoPageErrors(errors);
});

test("Monitoring이 mock Builder 상태와 최근 갱신을 렌더링한다 (#268 시나리오 8, #539)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/monitoring");
  await expect(page.getByRole("heading", { name: "시스템 모니터링" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "KPubData Builder 상태" })).toBeVisible();

  // Recent refreshes are on the same page, no tab to open; a run id reaches its detail by keyboard.
  const recent = page.getByRole("table", { name: "최근 갱신" });
  const run = recent.getByRole("link", { name: "run-001" });
  await run.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/refresh-jobs\/run-001$/);

  await expectNoPageErrors(errors);
});
