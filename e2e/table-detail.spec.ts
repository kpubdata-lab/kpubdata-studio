import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Table Detail on a Builder with a warehouse (#526), in a real browser.
 *
 * The dev server runs in mock mode, which has no warehouse, so this spec turns the real
 * Builder path on through the runtime config (`/config.js`) and answers the Builder
 * calls itself. It checks what jsdom cannot: the page opens on the current snapshot with
 * no picker, a past snapshot is chosen from the keyboard in the Snapshots tab, and at
 * 390px the page does not scroll sideways.
 */
const API = "http://builder.test";
const TABLE = { table_id: "t1", logical_name: "air_quality.datago__air", current_snapshot_id: "snap_3", revision: 3 };
const snapshot = (snapshot_id: string, run_id: string, row_count: number) => ({
  snapshot_id,
  run_id,
  state: "committed",
  row_count,
  created_at: "2026-09-01T00:00:00Z",
  committed_at: "2026-09-01T00:00:00Z",
  coverage: null,
});
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
  run_count: 2,
};

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
    if (url.pathname === "/warehouse/tables") return json({ tables: [TABLE] });
    if (url.pathname === `/warehouse/tables/${TABLE.logical_name}`) {
      return json({ ...TABLE, snapshots: [snapshot("snap_3", "run-3", 4821), snapshot("snap_2", "run-2", 4700)] });
    }
    if (url.pathname === "/datasets/air_quality") return json(DATASET);
    if (url.pathname === "/datasets/air_quality/runs") {
      return json({ dataset_id: "air_quality", runs: [{ run_id: "run-3", status: "ok", started_at: null, finished_at: null, spec_digest: null, created_by: null }] });
    }
    // Anything else (version, admin probe) behaves as a Builder that is not there.
    return route.abort("connectionrefused");
  });
}

test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("테이블 상세는 선택 없이 현재 스냅샷으로 열리고, 과거 스냅샷은 스냅샷 탭에서 키보드로 고르며, 390px 에서 가로 스크롤이 없다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await stubBuilder(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tables/air_quality");
  await expect(page.getByRole("heading", { level: 1, name: DATASET.title })).toBeVisible({ timeout: 10_000 });
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("snap_3");
  await expect(panel).toContainText("4,821");
  await expect(page.getByRole("combobox")).toHaveCount(0);

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), "/tables/:id horizontal overflow at 390px").toBeLessThanOrEqual(2);

  // Keyboard only: open the Snapshots tab and view the past snapshot.
  await page.getByRole("tab", { name: t("tableDetail.tabs.snapshots") }).focus();
  await page.keyboard.press("Enter");
  const view = page.getByRole("button", { name: t("tableDetail.view"), exact: true });
  await expect(view).toBeVisible();
  expect(await overflow(), "Snapshots tab horizontal overflow at 390px").toBeLessThanOrEqual(2);
  await view.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tables\/air_quality\?snapshot=snap_2$/);
  await expect(page.getByRole("tabpanel")).toContainText("run-2");

  await expectNoPageErrors(errors);
});
