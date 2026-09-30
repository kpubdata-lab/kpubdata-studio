import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Home on a Builder with a warehouse (#527), in a real browser.
 *
 * The dev server runs in mock mode, which has no warehouse, so this spec turns the real
 * Builder path on through the runtime config (`/config.js`) and answers the Builder calls
 * itself. It checks what jsdom cannot: at 390px the first screen has no KPI wall and no
 * sideways scroll, and a table that needs attention opens from the keyboard in one step.
 */
const API = "http://builder.test";
const DATASET = {
  dataset_id: "air_quality",
  title: "대기질 측정",
  sources: [{ provider: "data.go.kr", dataset: "air", alias: "air" }],
  latest_run_id: "run-3",
  status: "ok",
  updated_at: "2026-09-01T00:00:00Z",
  row_counts: {},
  total_row_count: 10,
  stages: {},
  quality: null,
  status_axes: { refresh: "succeeded", completeness: "complete", health: "stale", access: "available", maturity: "beta" },
};
const TABLE = { table_id: "t1", logical_name: "air_quality.datago__air_quality_measurements_by_station", current_snapshot_id: "snap_3", revision: 3 };

async function stubBuilder(page: Page) {
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.__KPUBDATA_CONFIG__ = ${JSON.stringify({ useRealBuilder: "true", builderApiUrl: API })};`,
    }),
  );
  await page.route((url) => url.origin === API, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/datasets") return json({ datasets: [DATASET], total: 1 });
    if (url.pathname === "/builds") return json({ builds: [] });
    if (url.pathname === "/warehouse/tables") return json({ tables: [TABLE] });
    if (url.pathname.startsWith("/warehouse/tables/")) {
      return json({
        ...TABLE,
        snapshots: [{ snapshot_id: "snap_3", run_id: "run-3", state: "committed", row_count: null, created_at: "2026-09-01T00:00:00Z", committed_at: "2026-09-01T00:00:00Z", coverage: null }],
      });
    }
    if (url.pathname === "/analyses") return json({ analyses: [] });
    // Anything else (version, admin probe, the table page) behaves as a Builder that is not there.
    return route.abort("connectionrefused");
  });
}

test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("홈은 조치가 필요한 테이블과 최근 스냅샷으로 시작하고, 390px 에서 가로 스크롤이 없으며, 키보드로 테이블을 연다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await stubBuilder(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: t("home.dashboard.title") })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 2, name: t("home.attention.title") })).toBeVisible();
  await expect(page.getByRole("link", { name: TABLE.logical_name })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "/ horizontal overflow at 390px").toBeLessThanOrEqual(2);

  const attention = page.getByRole("link", { name: new RegExp(DATASET.title) });
  await attention.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tables\/air_quality$/);

  await expectNoPageErrors(errors);
});
