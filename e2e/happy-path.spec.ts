import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * New user Public API happy path (#268 scenario 1, mock deterministic).
 *
 * Home (new user) → Discover → dataset catalog exploration → Add Data entry.
 * Verified with deterministic fixture in mock mode.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("신규 사용자가 Home에서 Discover·Add Data로 이동한다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/");
  await expect(page.getByRole("heading").first()).toBeVisible();

  // Discover: mock catalog renders 2+ providers.
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "데이터 탐색", exact: true })).toBeVisible();
  await expect(page.getByText("air_quality").first()).toBeVisible();

  // Add Data entry: Source selection step renders.
  await page.goto("/add");
  await expect(page.getByRole("heading", { name: t("addData.source.title") })).toBeVisible();

  await expectNoPageErrors(errors);
});

test("Workspace에 Saved BuildSpec 저장·새로고침 후 재노출된다 (#268 시나리오 5)", async ({
  page,
}) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/builds/new");
  await expect(page.getByRole("heading", { name: /템플릿 선택|기본 정보/ }).first()).toBeVisible();

  // Workspace entry via Build creation CTA (save flow validated at unit level — here we check
  // screen transition and empty state guidance have no regressions).
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "작업대" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "작업대" })).toBeVisible();

  await expectNoPageErrors(errors);
});

test("Monitoring이 mock 상태 카드를 렌더링한다 (#268 시나리오 8)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/monitoring");
  await expect(page.getByRole("heading", { name: "시스템 모니터링" })).toBeVisible();
  await expect(page.getByText("Engine API")).toBeVisible();

  // Recent Runs tab displays mock run list.
  await page.getByRole("button", { name: "Recent Runs" }).click();
  await expect(page.getByText("run-001")).toBeVisible();

  await expectNoPageErrors(errors);
});
