import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Tables on a Builder with a warehouse (#525), in a real browser.
 *
 * The dev server runs in mock mode, whose demo warehouse is not this fixture, so this spec turns the real
 * Builder path on through the runtime config (`/config.js`) and answers the Builder
 * calls itself. What it checks is what jsdom cannot: a row opens from the keyboard alone,
 * and at 390px the wide table scrolls inside its card, not the page.
 */
const API = "http://builder.test";

const DATASET = {
  dataset_id: "air_quality",
  title: "대기질 측정",
  sources: [{ provider: "data.go.kr", dataset: "air", alias: "air" }],
  latest_run_id: "run-1",
  status: "ok",
  updated_at: "2026-09-01T00:00:00Z",
  row_counts: {},
  total_row_count: 10,
  stages: {},
  quality: null,
  status_axes: { refresh: "succeeded", completeness: "partial", health: "healthy", access: "available", maturity: "beta" },
};
const TABLE = { table_id: "t1", logical_name: "air_quality.datago__air", current_snapshot_id: "snap_3", revision: 3 };
const SNAPSHOT = {
  snapshot_id: "snap_3",
  run_id: "run-1",
  state: "committed",
  row_count: 4821,
  created_at: "2026-09-01T00:00:00Z",
  committed_at: "2026-09-01T00:00:00Z",
  coverage: null,
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
    // A second table the warehouse has nothing for: its cells are `—` with screen-reader text.
    if (url.pathname === "/datasets") return json({ datasets: [DATASET, { ...DATASET, dataset_id: "weather", title: "기상" }] });
    if (url.pathname === "/warehouse/tables") return json({ tables: [TABLE] });
    if (url.pathname === `/warehouse/tables/${TABLE.logical_name}`) return json({ ...TABLE, snapshots: [SNAPSHOT] });
    // Anything else (version, admin probe, the detail page) behaves as a Builder that is not there.
    return route.abort("connectionrefused");
  });
}

test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("테이블 목록은 현재 스냅샷과 행 수를 보이고, 키보드로 행을 열며, 390px 에서 페이지 가로 스크롤이 없다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await stubBuilder(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tables");
  const row = page.getByRole("link", { name: t("catalog.openDetail").replace("{{title}}", DATASET.title) });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText("snap_3");
  await expect(row).toContainText("4,821");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "/tables horizontal overflow at 390px").toBeLessThanOrEqual(2);

  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tables\/air_quality$/);

  await expectNoPageErrors(errors);
});

test("390px 에서 상태 배지는 한 줄이고, 테이블 이름·현재 스냅샷·상태가 가로 스크롤 없이 보인다 (#573)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // Mock mode: the demo warehouse has a table whose access is rate limited, the badge #563 caught wrapping.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tables");
  const table = page.getByRole("table");
  const rows = table.getByRole("link");
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  await expect(table.getByText(t("statusAxes.value.access.rate_limited"))).toBeVisible();

  const report = await rows.evaluateAll((elements) => {
    const viewport = document.documentElement.clientWidth;
    const shown = (element: Element) => getComputedStyle(element).display !== "none" && element.getClientRects().length > 0;
    // Where an element is drawn, and on how many text lines.
    const place = (element: Element) => {
      const box = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top + rect.height / 2))).size;
      return { text: (element.textContent ?? "").trim(), left: Math.round(box.left), right: Math.round(box.right), lines };
    };
    return elements.map((row) => {
      const cells = Array.from(row.querySelectorAll(":scope > td"));
      const name = cells[0].firstElementChild ?? cells[0];
      const snapshot = cells.find((cell) => /snap_\d+/.test(cell.textContent ?? ""));
      const badges = Array.from(row.querySelectorAll('[data-status="actionable"]')).filter(shown);
      return { viewport, name: place(name), snapshot: snapshot && shown(snapshot) ? place(snapshot) : null, badges: badges.map(place) };
    });
  });

  expect(report.length).toBeGreaterThan(0);
  expect(report.some((row) => row.badges.length > 0), "some row needs action").toBe(true);
  // Every problem at once, so a failure shows the whole layout rather than the first cell.
  const problems: string[] = [];
  for (const row of report) {
    const inView = (item: { left: number; right: number }) => item.left >= 0 && item.right <= row.viewport;
    if (!inView(row.name)) problems.push(`table name "${row.name.text}" outside the viewport (${row.name.left}..${row.name.right})`);
    if (!row.snapshot) problems.push(`no current snapshot shown for "${row.name.text}"`);
    else if (!inView(row.snapshot)) problems.push(`snapshot "${row.snapshot.text}" outside the viewport (${row.snapshot.left}..${row.snapshot.right})`);
    for (const badge of row.badges) {
      if (badge.lines !== 1) problems.push(`badge "${badge.text}" wraps onto ${badge.lines} lines`);
      if (!inView(badge)) problems.push(`badge "${badge.text}" outside the viewport (${badge.left}..${badge.right})`);
    }
  }
  expect(problems).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "/tables horizontal overflow at 390px").toBeLessThanOrEqual(2);
  await expectNoPageErrors(errors);
});

test("alias 없는 source 의 테이블은 목록에서 열어도 현재 스냅샷과 행이 보인다 (#602)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // A public-API source without an alias is keyed `<provider>.<dataset>`, so the table's
  // name has more than one dot after the dataset id.
  const table = {
    table_id: "t1",
    logical_name: "air_quality.datago.air_station",
    current_snapshot_id: "snap_3",
    revision: 3,
    current_snapshot: { snapshot_id: "snap_3", row_count: 4821, committed_at: SNAPSHOT.committed_at, coverage: null },
    dataset_id: "air_quality",
  };
  const dataset = { ...DATASET, sources: [{ provider: "datago", dataset: "air_station", alias: "" }], run_count: 1 };
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.__KPUBDATA_CONFIG__ = ${JSON.stringify({ useRealBuilder: "true", builderApiUrl: API })};`,
    }),
  );
  await page.route((url) => url.origin === API, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/datasets") return json({ datasets: [dataset] });
    if (url.pathname === "/datasets/air_quality") return json(dataset);
    if (url.pathname === "/datasets/air_quality/runs") {
      return json({ dataset_id: "air_quality", runs: [{ run_id: "run-1", status: "ok", started_at: null, finished_at: null, spec_digest: null, created_by: null }] });
    }
    if (url.pathname === "/warehouse/tables") return json({ tables: [table] });
    if (url.pathname === `/warehouse/tables/${table.logical_name}`) return json({ ...table, snapshots: [SNAPSHOT] });
    if (url.pathname === "/warehouse/rows") {
      return json({
        snapshot: { table_id: "t1", logical_name: table.logical_name, snapshot_id: "snap_3", revision: 3 },
        columns: ["station"],
        column_meta: [{ name: "station", logical_type: "string", wire_encoding: "string" }],
        rows: [{ station: "강남구" }],
        order: [],
        page: { offset: 0, page_size: 50, returned: 1, has_more: false, next_offset: null },
        count: { status: "exact", value: 4821 },
        execution_ms: 1,
        startup_ms: 0,
        engine_execution_ms: 1,
      });
    }
    // Anything else (version, admin probe, quality) behaves as a Builder that is not there.
    return route.abort("connectionrefused");
  });

  await page.goto("/tables");
  const row = page.getByRole("link", { name: t("catalog.openDetail").replace("{{title}}", DATASET.title) });
  await expect(row).toContainText("snap_3", { timeout: 10_000 });
  await row.click();
  await expect(page).toHaveURL(/\/tables\/air_quality$/);

  await expect(page.getByRole("tabpanel")).toContainText("snap_3", { timeout: 10_000 });
  await page.getByRole("tab", { name: t("tableDetail.tabs.preview") }).click();
  await expect(page.getByRole("tabpanel")).toContainText("강남구");

  await expectNoPageErrors(errors);
});
