import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * Ask KPubData scenario (#268 scenario 6, mock demo).
 *
 * - Ask KPubData screen entry·show BYOK not configured onboarding
 * - Send demo question (deterministic mock evidence) → render answer turn
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("Ask KPubData가 BYOK onboarding과 데모 질문 진입점을 표시한다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/assistant");
  await expect(
    page.getByRole("heading", { name: /Ask KPubData/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("API Key").first()).toBeVisible();

  await expectNoPageErrors(errors);
});

test("데모 질문이 결정적 mock 답변 turn를 만든다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: /Ask KPubData/i }).first()).toBeVisible();

  const demoButton = page.getByRole("button", { name: /데모 질문/ }).first();
  await expect(demoButton).toBeVisible();
  await demoButton.click();

  // Demo question ("What's the quality of this dataset?") appears as question turn (#256 deterministic demo).
  await expect(page.getByText("이 데이터셋 품질 어때?").first()).toBeVisible({
    timeout: 10_000,
  });

  await expectNoPageErrors(errors);
});

test("Ask KPubData 질문 입력이 라벨/aria로 접근 가능하다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/assistant");
  const input = page.getByLabel("Ask KPubData 에 질문하기").first();
  await expect(input).toBeVisible();

  await expectNoPageErrors(errors);
});
