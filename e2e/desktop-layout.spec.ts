import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Layout defects the screenshot baselines once held (#698), checked by geometry so they fail
 * on any OS, not only where the Linux baselines are compared:
 *
 * - Catalog at 1440px: the Start button and the status badges stay on one line. A squeezed
 *   column used to break its two-syllable Korean label into one syllable a line.
 * - Home at 1440px: every column of the recent snapshots table is inside its card. The last
 *   one used to be cut off. At 390px the table scrolls inside its own region and the page
 *   does not scroll sideways — the same rule as the Catalog table.
 */
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

test.use({ locale: "ko-KR", timezoneId: "Asia/Seoul" });

test.beforeEach(async ({ page }, testInfo) => {
  // The viewports are set per test; the mobile project would only repeat them.
  test.skip(testInfo.project.name !== "desktop-chromium", "viewports are fixed per test");
  await prepareCleanPage(page);
});

/**
 * How many lines an element's text runs over: the distinct rows of its text's client rects.
 * Rects of 1px or less (the `sr-only` text) are left out.
 */
async function lineCount(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = [...range.getClientRects()]
      .filter((rect) => rect.width > 1 && rect.height > 1)
      .map((rect) => rect.top)
      .sort((a, b) => a - b);
    // Glyphs from different fonts on one line can sit a pixel or two apart.
    return tops.filter((top, index) => index === 0 || top - tops[index - 1] > 4).length;
  });
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("catalog at 1440px keeps every Start button and status badge on one line", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await page.setViewportSize(DESKTOP);
  await page.goto("/discover");
  const region = page.getByRole("region", { name: t("discover.table.caption") });
  await expect(region.getByRole("row", { name: /대기오염 정보/ })).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);

  const starts = region.getByRole("button", { name: new RegExp(`^${t("discover.startWith")} — `) });
  expect(await starts.count()).toBeGreaterThan(0);
  const regionBox = await region.boundingBox();
  for (const start of await starts.all()) {
    expect(await lineCount(start), `${await start.getAttribute("aria-label")} wraps`).toBe(1);
    const box = await start.boundingBox();
    expect(box!.x + box!.width, "the Start button is inside the table's visible area").toBeLessThanOrEqual(regionBox!.x + regionBox!.width);
  }

  // Access and maturity badges: the "unknown" label used to break one syllable a line too.
  const badges = region.locator("tbody span.rounded-full");
  expect(await badges.count()).toBeGreaterThan(0);
  for (const badge of await badges.all()) {
    expect(await lineCount(badge), `badge "${await badge.textContent()}" wraps`).toBe(1);
  }

  expect(await pageOverflow(page), "/discover scrolls sideways at 1440px").toBeLessThanOrEqual(0);
  await expectNoPageErrors(errors);
});

test("home at 1440px shows every recent snapshot column; at 390px the table scrolls inside its region", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  const region = page.getByRole("region", { name: t("home.snapshots.title") });

  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(region.getByText("snap_012")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);

  const fit = await region.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(fit.scroll, "the recent snapshots table is wider than its card at 1440px").toBeLessThanOrEqual(fit.client);
  const regionBox = await region.boundingBox();
  const lastHeader = await region.getByRole("columnheader", { name: t("home.snapshots.run") }).boundingBox();
  expect(lastHeader!.x + lastHeader!.width, "the run column is cut off").toBeLessThanOrEqual(regionBox!.x + regionBox!.width + 0.5);
  for (const header of await region.getByRole("columnheader").all()) {
    expect(await lineCount(header), `header "${await header.textContent()}" wraps`).toBe(1);
  }
  expect(await pageOverflow(page), "/ scrolls sideways at 1440px").toBeLessThanOrEqual(0);

  await page.setViewportSize(PHONE);
  await expect(region.getByText("snap_012")).toBeVisible();
  const narrow = await region.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(narrow.scroll, "at 390px the table scrolls inside its region").toBeGreaterThan(narrow.client);
  expect(await pageOverflow(page), "/ scrolls sideways at 390px").toBeLessThanOrEqual(0);
  await region.focus();
  await expect(region, "the scroll region takes keyboard focus").toBeFocused();

  await expectNoPageErrors(errors);
});
