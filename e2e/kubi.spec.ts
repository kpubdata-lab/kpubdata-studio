import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * Kubi 시나리오 (#268 시나리오 6, mock demo).
 *
 * - Kubi 화면 진입·BYOK 미설정 onboarding 표시
 * - 데모 질문(결정적 mock evidence) 송신 → 답변 turn 렌더링
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

  // 데모 질문("이 데이터셋 품질 어때?")이 질문 turn로 남는다(#256 결정적 데모).
  await expect(page.getByText("이 데이터셋 품질 어때?").first()).toBeVisible({
    timeout: 10_000,
  });

  await expectNoPageErrors(errors);
});

test("Kubi 질문 입력이 라벨/aria로 접근 가능하다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/kubi");
  const input = page.getByLabel("Ask KPubData 에 질문하기").first();
  await expect(input).toBeVisible();

  await expectNoPageErrors(errors);
});
