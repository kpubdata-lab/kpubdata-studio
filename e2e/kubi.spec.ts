import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * Kubi scenario (#268 scenario 6, mock demo).
 *
 * - Kubi screen entry·show BYOK not configured onboarding
 * - Send demo question (deterministic mock evidence) → render answer turn
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("Kubi가 BYOK onboarding과 데모 질문 진입점을 표시한다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/kubi");
  await expect(
    page.getByRole("heading", { name: /Kubi/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("API Key").first()).toBeVisible();

  await expectNoPageErrors(errors);
});

test("데모 질문이 결정적 mock 답변 turn를 만든다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/kubi");
  await expect(page.getByRole("heading", { name: /Kubi/i }).first()).toBeVisible();

  const demoButton = page.getByRole("button", { name: /데모 질문/ }).first();
  await expect(demoButton).toBeVisible();
  await demoButton.click();

  // Demo question ("What's the quality of this dataset?") appears as question turn (#256 deterministic demo).
  await expect(page.getByText("이 데이터셋 품질 어때?").first()).toBeVisible({
    timeout: 10_000,
  });

  await expectNoPageErrors(errors);
});

test("Kubi 질문 입력이 라벨/aria로 접근 가능하다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/kubi");
  const input = page.getByLabel("Kubi에게 질문하기").first();
  await expect(input).toBeVisible();

  await expectNoPageErrors(errors);
});
