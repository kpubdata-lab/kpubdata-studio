import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * The warehouse SQL Workspace's table explorer (#528), in a real browser.
 *
 * The dev server runs in mock mode, whose demo warehouse is not this fixture, so this spec turns the real
 * Builder path on through the runtime config (`/config.js`) and answers the Builder
 * calls itself. What it checks is what jsdom cannot: the tree works from the keyboard
 * alone, and at 390px the page does not scroll sideways.
 */
const API = "http://builder.test";
const TABLES = [
  { table_id: "t1", logical_name: "air_quality.datago__air_quality_measurements_by_station", current_snapshot_id: "snap_3", revision: 3 },
  { table_id: "t2", logical_name: "weather.kma", current_snapshot_id: "snap_1", revision: 1 },
];

async function stubWarehouse(page: Page, queries: unknown[]) {
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.__KPUBDATA_CONFIG__ = ${JSON.stringify({ useRealBuilder: "true", builderApiUrl: API })};`,
    }),
  );
  await page.route((url) => url.origin === API, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/warehouse/tables") return json({ tables: TABLES });
    if (url.pathname.startsWith("/warehouse/tables/")) {
      const table = TABLES.find((item) => item.logical_name === decodeURIComponent(url.pathname.split("/").pop() ?? ""))!;
      return json({
        ...table,
        snapshots: [{ snapshot_id: table.current_snapshot_id, run_id: "r", state: "committed", row_count: 2, created_at: "x", committed_at: "x", coverage: null }],
      });
    }
    if (url.pathname === "/warehouse/rows") {
      return json({
        snapshot: { table_id: "t1", logical_name: TABLES[0].logical_name, snapshot_id: "snap_3", revision: 3 },
        columns: ["station_name", "pm10_concentration_micrograms_per_cubic_meter"],
        column_meta: [],
        rows: [],
        order: [],
        page: { offset: 0, page_size: 1, returned: 0, has_more: false, next_offset: null },
        count: { status: "not_computed", value: null },
        execution_ms: 1,
        startup_ms: 0,
        engine_execution_ms: 1,
      });
    }
    if (url.pathname === "/warehouse/query") {
      queries.push(route.request().postDataJSON());
      return json({
        snapshot: { table_id: "t1", logical_name: TABLES[0].logical_name, snapshot_id: "snap_3", revision: 3 },
        result: { columns: ["station_name"], rows: [{ station_name: "a" }], truncated: false, execution_ms: 5 },
      });
    }
    // Anything else (version, admin probe) behaves as a Builder that is not there.
    return route.abort("connectionrefused");
  });
}

test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("테이블 탐색기는 키보드만으로 소스를 고르고 컬럼을 넣으며, 390px 에서 가로 스크롤이 없다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  const queries: unknown[] = [];
  await stubWarehouse(page, queries);

  await page.goto("/sql");
  const tree = page.getByRole("tree", { name: t("sql.explorer.title") });
  await expect(tree).toBeVisible({ timeout: 10_000 });

  // Keyboard only: focus the tree's tab stop, walk to the first source, pick it.
  await tree.getByRole("treeitem", { name: "air_quality", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  const source = tree.getByRole("treeitem", { name: TABLES[0].logical_name });
  await expect(source).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dataset-binding")).toContainText(`dataset → ${TABLES[0].logical_name} @ current (snap_3)`);

  // Expand the source and insert its first column; nothing runs.
  await page.keyboard.press("ArrowRight");
  // Columns load lazily; wait for them before stepping into the list.
  await expect(tree.getByRole("treeitem", { name: "station_name" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(tree.getByRole("treeitem", { name: "station_name" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "SQL" })).toHaveValue(/station_name/);
  expect(queries).toHaveLength(0);

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), "/sql horizontal overflow").toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await overflow(), "/sql horizontal overflow at 390px").toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: /실행 ⌘/ }).click();
  await expect(page.getByTestId("result-footer")).toContainText("LIMIT 100");
  expect(queries).toHaveLength(1);

  await expectNoPageErrors(errors);
});
