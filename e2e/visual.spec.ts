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
 * `maxDiffPixels` is an absolute budget for anti-aliasing, far below one status badge
 * (about 80x20 px), so a badge changing colour or a moved section fails. `threshold` is how
 * far apart two colours may be before a pixel counts as different at all: Playwright's
 * default (0.2) reads indigo `#5B5BD6` and Brand Blue `#2563EB`, or a warning badge and a
 * failure badge, as the same colour, so a colour-only change passed (#697). The baselines
 * come from one pinned container, so the strict value holds. The spec never
 * retries: a shot that differs on the first try is a real difference or a flaky screen,
 * and both should be seen.
 *
 * Off Linux the spec is skipped — a macOS or Windows render never matches, and a missing
 * baseline would be written next to the Linux ones. `UPDATE_VISUAL=1` runs it anyway.
 *
 * The 390px shots are the desktop-chromium project at a 390px viewport: they check layout
 * at phone width, not touch input or a phone's device pixel ratio.
 *
 * To update after an intended change, on any OS with Docker:
 *
 *   npm run test:e2e:update-visual
 *
 * It runs this spec with `--update-snapshots` in `mcr.microsoft.com/playwright:v1.63.0-noble`,
 * the image for the installed `@playwright/test`, so the fonts and Chromium are the same
 * wherever it runs. Review the new images in the PR. A pull request that bumps
 * `@playwright/test` changes Chromium: bump the image tag in `package.json` to match and
 * refresh the baselines in the same pull request.
 */

/** Anti-aliasing budget per shot; a status badge alone is about 1,600 px. */
const MAX_DIFF_PIXELS = 200;

/**
 * Per-pixel colour tolerance (pixelmatch's YIQ distance, 0-1). Playwright's default 0.2
 * lets a status token swap through; 0.05 does not (#697).
 */
const COLOR_THRESHOLD = 0.05;

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
test.describe.configure({ retries: 0 });

test.beforeEach(async ({ page }, testInfo) => {
  // One project renders every viewport; the mobile project would only repeat the shots.
  test.skip(testInfo.project.name !== "desktop-chromium", "baselines are taken once, at fixed viewports");
  test.skip(process.platform !== "linux" && !process.env.UPDATE_VISUAL, "baselines are Linux Chromium renders; see the header for updating them");
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
        maxDiffPixels: MAX_DIFF_PIXELS,
        threshold: COLOR_THRESHOLD,
      });
      await expectNoPageErrors(errors);
    });
  }
}
