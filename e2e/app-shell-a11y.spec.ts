import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * App shell accessibility in a real browser: the skip link and the main landmark (#660),
 * focus and the document title after a client-side navigation (#662), and reduced motion
 * (#664). Runs on both the desktop and the mobile project.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

const title = (page: string) => t("layout.documentTitle").replace("{{page}}", page);

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible({ timeout: 10_000 });
}

test("the first Tab reaches a skip link that jumps to the one main landmark (#660)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await openHome(page);

  await expect(page.getByRole("main")).toHaveCount(1);

  const skip = page.getByRole("link", { name: t("layout.skipToContent") });
  // Visually hidden (the 1px sr-only box) until it has focus.
  expect((await skip.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);

  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())?.width ?? 0).toBeGreaterThan(1);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  // The hash is not changed: the router's URL stays as it was.
  expect(new URL(page.url()).hash).toBe("");

  // The next Tab starts inside the page, not back in the sidebar.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.querySelector("main")?.contains(document.activeElement) ?? false)).toBe(true);

  await expectNoPageErrors(errors);
});

test("a navigation moves focus to the new page's heading and renames the tab (#662)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await openHome(page);

  await expect(page).toHaveTitle(title(t("nav.home")));
  // A page load is not a navigation: nothing takes focus.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  const toggle = page.getByRole("button", { name: t("layout.toggleSidebar") });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .getByRole("navigation", { name: t("layout.mainNav") })
    .getByRole("link", { name: t("nav.settings") })
    .click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page).toHaveTitle(title(t("nav.settings")));
  await expect(page.locator("main h1")).toBeFocused();

  // Back to a page that was already loaded: the same rule.
  await page.goBack();
  await expect(page).toHaveTitle(title(t("nav.home")));
  await expect(page.locator("main h1")).toBeFocused();

  await expectNoPageErrors(errors);
});

async function animationNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = '<span class="animate-pulse">p</span><span class="animate-spin">s</span>';
    document.body.append(host);
    const names = [...host.children].map((el) => getComputedStyle(el).animationName);
    host.remove();
    return names;
  });
}

test("spinners and pulses stop under prefers-reduced-motion and run otherwise (#664)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openHome(page);
  expect(await animationNames(page)).toEqual(["pulse", "spin"]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animationNames(page)).toEqual(["none", "none"]);
  // The shell's own transitions (the sidebar slide) stop too.
  expect(await page.locator("#app-sidebar").evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
});
