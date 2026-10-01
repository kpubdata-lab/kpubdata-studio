import { expect, test, type Locator } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * Demo mode stays visible while browsing (#672), in a real browser: the top bar's DEMO
 * badge is on every screen and, at phone width, overlaps none of the other top-bar
 * controls. Mock mode — the e2e server never enables the real Builder.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("element has no box");
  return value;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("데모 모드 표시는 모든 화면 상단에 남고 390px 에서 다른 상단 요소를 가리지 않는다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ["/", "/discover", "/connections", "/tables"]) {
    await page.goto(path);
    const header = page.getByRole("banner");
    const indicator = header.getByTestId("demo-indicator");
    await expect(indicator, `${path} shows DEMO`).toBeVisible();
    await expect(indicator).toContainText("DEMO");

    const badge = await box(indicator);
    // Every other top-bar control: sidebar toggle, breadcrumb, search, Ask KPubData, account.
    const others = await header.locator("button:visible, nav").all();
    expect(others.length).toBeGreaterThanOrEqual(5);
    for (const other of others) {
      expect(overlaps(badge, await box(other)), `${path}: DEMO overlaps a top-bar control`).toBe(false);
    }
    // Polled: a page's loading skeleton can be briefly wider than the phone before data arrives.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
        message: `${path} horizontal overflow at 390px`,
      })
      .toBeLessThanOrEqual(2);
  }

  await expectNoPageErrors(errors);
});
