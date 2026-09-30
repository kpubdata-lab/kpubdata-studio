import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Screenshot baselines for the core screens (#532).
 *
 * The redesign's success criteria — header density, no wall of cards, 36px rows, how much
 * status colour a screen carries, nothing overflowing on a phone — are about what a
 * screen looks like, not which Tailwind classes it has. These baselines hold that: Home,
 * Tables, Table Detail, SQL Workspace and Catalog, at desktop width and at 390px, full
 * page, compared on every CI run by `npx playwright test` like any other spec.
 *
 * Deterministic by construction: the dev server runs in mock mode, so every value comes
 * from the demo fixtures (#530); the clock, time zone and locale are fixed; animations
 * and the caret are off; each screen waits for its data before the shot. The baselines
 * live next to this file (`visual.spec.ts-snapshots/`) and are Linux Chromium renders.
 * `maxDiffPixelRatio` absorbs anti-aliasing between machines, not layout changes: a moved
 * section or a new card changes far more than 1% of the page.
 *
 * To update after an intended change: `CI=1 npx playwright test e2e/visual.spec.ts
 * --update-snapshots`, on Linux, and review the new images in the PR.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

interface Screen {
  name: string;
  path: string;
  /** Resolves once the screen shows its data, not a skeleton. */
  ready: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  {
    name: "home",
    path: "/",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: t("home.dashboard.title") })).toBeVisible();
      await expect(page.getByText("snap_012").first()).toBeVisible();
    },
  },
  {
    name: "tables",
    path: "/tables",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("snap_012").first()).toBeVisible();
    },
  },
  {
    name: "table-detail",
    path: "/tables/air-quality",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "대기질 통합 데이터" })).toBeVisible();
      await expect(page.getByText("snap_012").first()).toBeVisible();
    },
  },
  {
    name: "sql",
    path: "/sql",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "SQL Workspace" })).toBeVisible();
      await expect(page.getByRole("treeitem", { name: "air-quality.datago__air" })).toBeVisible();
    },
  },
  {
    name: "catalog",
    path: "/discover",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("air_quality").first()).toBeVisible();
    },
  },
];

test.use({ locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: "light" });

test.beforeEach(async ({ page }, testInfo) => {
  // One project renders every viewport; the mobile project would only repeat the shots.
  test.skip(testInfo.project.name !== "desktop-chromium", "baselines are taken once, at fixed viewports");
  await prepareCleanPage(page);
  // Relative times ("3 days ago") and "today" must not drift with the calendar.
  await page.clock.setFixedTime(new Date("2026-08-15T03:00:00Z"));
});

for (const viewport of VIEWPORTS) {
  for (const screen of SCREENS) {
    test(`${screen.name} @ ${viewport.name}: matches its baseline and has no page-level horizontal scroll`, async ({ page }) => {
      const errors: string[] = [];
      collectPageErrors(page, errors);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto(screen.path);
      await screen.ready(page);
      await page.evaluate(() => document.fonts.ready);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${screen.path} scrolls sideways at ${viewport.width}px`).toBeLessThanOrEqual(0);

      await expect(page).toHaveScreenshot(`${screen.name}-${viewport.name}.png`, {
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      });
      await expectNoPageErrors(errors);
    });
  }
}
