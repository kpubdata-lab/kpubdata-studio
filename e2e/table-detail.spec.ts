import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Table Detail on a Builder with a warehouse (#526), in a real browser.
 *
 * The dev server runs in mock mode, whose demo warehouse is not this fixture, so this spec turns the real
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

const SPEC = [
  "dataset_id: air_quality",
  "license: other",
  "license_name: kogl-type-1",
  "license_link: https://www.kogl.or.kr/info/licenseType1.do",
  "attribution: 서울특별시, 서울시 대기환경정보",
  "",
].join("\n");
const profile = (snapshot_id: string) => ({
  snapshot: { table_id: TABLE.table_id, logical_name: TABLE.logical_name, snapshot_id, revision: 3 },
  profile: {
    snapshot_id,
    artifact_digest: "sha256:abc",
    algorithm_version: 2,
    computed_at: "2026-09-01T00:00:00Z",
    scope: { mode: "full", sampled: false, sample_size: null },
    accuracy: "exact",
    min_range_values: 10,
    row_count: 4821,
    columns: [
      {
        name: "pm10",
        storage_type: "Float64",
        logical_type: "float64",
        time_zone: null,
        sensitivity: { status: "not_detected", kinds: [] },
        status: "profiled",
        null_count: 12,
        null_ratio: 0.0025,
        nan_count: 0,
        infinite_count: 0,
        range: { status: "exact", min: 1.5, max: 310, wire_encoding: "number", value_count: 4809, excluded_count: 0 },
      },
      {
        name: "contact",
        storage_type: "String",
        logical_type: "string",
        time_zone: null,
        sensitivity: { status: "suspected", kinds: ["phone"] },
        status: "withheld",
        null_count: null,
        null_ratio: null,
        nan_count: null,
        infinite_count: null,
        range: null,
      },
    ],
  },
});

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
    if (url.pathname === "/builds/run-3/spec") return json({ run_id: "run-3", spec: SPEC, spec_digest: `sha256:${"0".repeat(64)}` });
    if (url.pathname === `/warehouse/tables/${TABLE.logical_name}/profile`) return json(profile(url.searchParams.get("snapshot") ?? ""));
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

test("테이블 상세 개요에 이용 조건과 원문 링크가 보이고, 컬럼 프로파일은 보고 있는 스냅샷으로 열리며 390px 에서 가로 스크롤이 없다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await stubBuilder(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tables/air_quality");
  const terms = page.getByRole("region", { name: t("licence.title") });
  await expect(terms).toContainText("kogl-type-1", { timeout: 10_000 });
  await expect(terms).toContainText(t("licence.kind.kogl"));
  await expect(terms.getByRole("link", { name: /kogl\.or\.kr/ })).toHaveAttribute("href", "https://www.kogl.or.kr/info/licenseType1.do");

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), "Overview with terms horizontal overflow at 390px").toBeLessThanOrEqual(2);

  const profileRequest = page.waitForRequest((request) => request.url().includes("/profile?"));
  await page.getByRole("button", { name: t("profile.open") }).click();
  expect(new URL((await profileRequest).url()).searchParams.get("snapshot")).toBe("snap_3");
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("rowheader", { name: "pm10" })).toBeVisible();
  await expect(panel).toContainText(t("profile.withheld"));
  expect(await overflow(), "Profile tab horizontal overflow at 390px").toBeLessThanOrEqual(2);

  await expectNoPageErrors(errors);
});

test("테이블 상세의 탭은 화살표·Home·End 로 움직이고, Tab 은 목록을 떠나 패널로 가며, axe 위반이 없다 (#795)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await stubBuilder(page);

  await page.goto("/tables/air_quality");
  await expect(page.getByRole("tabpanel")).toContainText("snap_3", { timeout: 10_000 });
  const tab = (key: string) => page.getByRole("tab", { name: t(`tableDetail.tabs.${key}`) });
  const tabs = page.getByRole("tab");
  const ids = ["overview", "schema", "profile", "preview", "quality", "snapshots"];
  await expect(tabs).toHaveCount(ids.length);

  // Only the selected tab is in the Tab order.
  for (const [i, key] of ids.entries()) await expect(tab(key)).toHaveAttribute("tabindex", i === 0 ? "0" : "-1");

  await tab("overview").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab("schema")).toBeFocused();
  await expect(tab("schema")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]tab=schema/);

  await page.keyboard.press("End");
  await expect(tab("snapshots")).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: t("tableDetail.tabs.snapshots") })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(tab("overview")).toBeFocused();
  await expect(tab("overview")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(tab("snapshots")).toBeFocused();
  await expect(tab("snapshots")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab("overview")).toBeFocused();
  await expect(tab("overview")).toHaveAttribute("aria-selected", "true");

  // Keys pressed faster than the URL updates still count from the focused tab.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tab("profile")).toBeFocused();
  await expect(tab("profile")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab("overview")).toHaveAttribute("aria-selected", "true");

  // Tab leaves the list for the panel; Shift+Tab comes back to the selected tab. The
  // panel is read once it shows the selected tab, as a person would.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tabpanel", { name: t("tableDetail.tabs.schema") })).toBeVisible();
  await page.keyboard.press("Tab");
  const leftList = await page.evaluate(() => document.activeElement?.closest('[role="tablist"]') === null);
  expect(leftList, "Tab moved focus out of the tab list").toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(tab("schema")).toBeFocused();

  // Every tab controls the panel, and the panel is named by the selected tab.
  const panelId = await page.getByRole("tabpanel").getAttribute("id");
  expect(panelId).toBeTruthy();
  for (const key of ids) await expect(tab(key)).toHaveAttribute("aria-controls", panelId!);

  const axe = await new AxeBuilder({ page })
    .include('[role="tablist"]')
    .include('[role="tabpanel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  await expectNoPageErrors(errors);
});
