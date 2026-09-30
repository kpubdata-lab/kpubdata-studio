import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Responsive·keyboard basics validation (#268: minimal viewport + keyboard/focus).
 * Same spec runs on both desktop/mobile projects (playwright.config projects).
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("주요 화면이 viewport에서 수평 오버플로 없이 렌더링된다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  for (const path of ["/", "/discover", "/monitoring", "/settings", "/workspace"]) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(2);
  }

  await expectNoPageErrors(errors);
});

test("키보드로 내비게이션 링크에 focus가 도달하고 focus가 보인다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/");

  // First Tab reaches focusable element (reaching itself is the goal, not exact element).
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();

  // Elements with focus-visible style are highlighted with outline etc. — only check class exists.
  const focusableCount = await page.locator("a[href], button:not([disabled])").count();
  expect(focusableCount).toBeGreaterThan(0);

  await expectNoPageErrors(errors);
});

test("390x844에서 topbar breadcrumb이 Ask KPubData/avatar 버튼과 겹치지 않는다 (UI audit #6-A, #423)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });

  const subtitle = page.getByRole("navigation", { name: "현재 위치" });
  const assistantButton = page.getByRole("button", { name: "Ask KPubData 열기" });
  await expect(subtitle).toBeVisible();
  await expect(assistantButton).toBeVisible();

  const subtitleBox = await subtitle.boundingBox();
  const assistantBox = await assistantButton.boundingBox();
  expect(subtitleBox).not.toBeNull();
  expect(assistantBox).not.toBeNull();
   // Two rectangles must not overlap — one must completely end to left of other (horizontal) or above
   // (vertical, if wrapped) to be "non-overlapping".
  if (subtitleBox && assistantBox) {
    const overlapsHorizontally = subtitleBox.x < assistantBox.x + assistantBox.width && assistantBox.x < subtitleBox.x + subtitleBox.width;
    const overlapsVertically = subtitleBox.y < assistantBox.y + assistantBox.height && assistantBox.y < subtitleBox.y + subtitleBox.height;
    expect(overlapsHorizontally && overlapsVertically, "subtitle과 Ask KPubData 버튼이 겹칩니다").toBe(false);
  }

  await expectNoPageErrors(errors);
});

test("390x844에서 ⌘K 팔레트로 키보드만 써서 테이블을 연다 (#533)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: t("layout.search.dialog") });
  await expect(dialog).toBeVisible();
  await page.keyboard.type("대기");

  const table = dialog.getByRole("option", { name: /대기질 통합 데이터/ });
  await expect(table).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("option").last()).toContainText("Ask KPubData");

  // The open palette stays inside the viewport: no page-level horizontal scroll.
  const box = await dialog.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390, "palette inside the 390px viewport").toBe(true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow with the palette open").toBeLessThanOrEqual(2);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tables\/air-quality$/);
  await expect(dialog).toBeHidden();

  await expectNoPageErrors(errors);
});

test("390x844에서 계정 메뉴의 언어·테마가 동작하고 가로 스크롤이 생기지 않는다 (#523)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "계정 메뉴" }).click();
  const menu = page.getByRole("dialog", { name: "계정" });
  await expect(menu).toBeVisible();

  await menu.getByLabel("테마").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // The open menu stays inside the viewport: no page-level horizontal scroll.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow with the account menu open").toBeLessThanOrEqual(2);

  await menu.getByLabel("언어").selectOption("en");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

  await expectNoPageErrors(errors);
});

test("390x844에서 Add Data sticky bottom actions가 마지막 content를 덮지 않는다 (UI audit #6-B)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/add");
  await expect(page.getByRole("heading", { name: "데이터 추가" })).toBeVisible({ timeout: 10_000 });

  await page.getByText("공공 API").click();
  await page.getByRole("button", { name: "다음" }).click();
  await page.locator("#add-data-provider").selectOption({ index: 1 });
  await page.locator("#add-data-dataset").selectOption({ index: 1 });
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByRole("button", { name: /Preview 새로고침/ }).click();
  await page.getByRole("button", { name: "다음" }).click();

  const buildButton = page.getByRole("button", { name: "테이블 만들기" });
  await buildButton.scrollIntoViewIfNeeded();
  await expect(buildButton).toBeVisible();

  const stickyBar = page.locator(".sticky.bottom-0");
  const buildBox = await buildButton.boundingBox();
  const stickyBox = await stickyBar.boundingBox();
  expect(buildBox).not.toBeNull();
  expect(stickyBox).not.toBeNull();
  if (buildBox && stickyBox) {
     // Even bottom half of Start Build button must not be hidden by sticky bar.
    expect(buildBox.y + buildBox.height, "테이블 만들기 버튼이 sticky bar에 가려집니다").toBeLessThanOrEqual(stickyBox.y);
  }

  await expectNoPageErrors(errors);
});

test("Login 폼이 라벨로 입력에 접근 가능하다 (접근성 기초)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/login");
  const email = page.getByLabel(/이메일/i).first();
  await expect(email).toBeVisible();
  await email.fill("e2e@example.com");
  await expect(email).toHaveValue("e2e@example.com");

  await expectNoPageErrors(errors);
});
