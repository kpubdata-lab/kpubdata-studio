import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * Tables → SQL → save → refresh → re-run against a real KPubData Builder (#417, @real-builder).
 *
 * The runner (scripts/run-real-e2e.mjs) starts Builder in replay mode (kpubdata-builder#837)
 * with a table catalog (`serve --warehouse`), so a public-API build commits a table
 * snapshot from a recorded fixture — no network, no service key. The spec builds the
 * table, opens it from Tables, queries it in the SQL Workspace, saves the analysis, then
 * builds the table again so `current` moves to a new snapshot. Re-running from Saved
 * Analyses must read the snapshot the analysis was saved with, not the new one.
 */
const BUILDER_URL = process.env.REAL_BUILDER_URL ?? "http://localhost:8000";

test.skip(!process.env.REAL_BUILDER_E2E, "needs a real Builder — scripts/run-real-e2e.mjs");

const DATASET_ID = "dataset.replay_saved_analysis";
const TITLE = "Replay saved analysis";
const LOGICAL_NAME = `${DATASET_ID}.measurements`;

/** Must match Builder's bundled replay fixture (`datago.air_station`, one page of 22 rows). */
const SPEC = [
  `dataset_id: ${DATASET_ID}`,
  `title: ${TITLE}`,
  "description: Tables to SQL to Saved Analyses over a replayed public API source",
  "sources:",
  "  - provider: datago",
  "    dataset: air_station",
  "    alias: measurements",
  "    params:",
  "      station: 강남구",
  "      term: daily",
  "      page: 1",
  "      page_size: 100",
  "exports:",
  "  - kind: jsonl",
  "    output_path: out/data.jsonl",
].join("\n");

/** Build the table once through Builder and return the snapshot it committed. */
async function buildTable(request: APIRequestContext, runId: string): Promise<string> {
  const response = await request.post(`${BUILDER_URL}/build`, { data: { spec: SPEC, run_id: runId }, timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as {
    status?: string;
    materialized?: Record<string, { logical_name?: string; snapshot_id?: string }>;
  };
  expect(body.status).toBe("ok");
  const committed = body.materialized?.measurements;
  expect(committed?.logical_name, "Builder runs with a table catalog (serve --warehouse)").toBe(LOGICAL_NAME);
  expect(committed?.snapshot_id).toBeTruthy();
  return committed?.snapshot_id ?? "";
}

async function openFromMenu(page: Page, label: RegExp): Promise<void> {
  await page.getByRole("navigation", { name: /^(주 메뉴|Main menu)$/ }).getByRole("link", { name: label }).first().click();
}

test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("테이블 → SQL → 저장 → 갱신 → 저장된 분석 재실행이 저장한 스냅샷을 읽는다 (#417) @real-builder", async ({
  page,
  request,
}) => {
  test.skip(!process.env.REAL_BUILDER_REPLAY, "needs Builder replay mode (kpubdata-builder#837)");

  const errors: string[] = [];
  collectPageErrors(page, errors);

  const stamp = Date.now();
  const saved = await buildTable(request, `ui-saved-analysis-a-${stamp}`);

  // 1) Tables → the table (a warehouse table opens on its current snapshot).
  await page.goto("/");
  await openFromMenu(page, /^(테이블|Tables)$/);
  await expect(page).toHaveURL(/\/tables$/);
  await page.getByText(TITLE).first().click();
  await expect(page).toHaveURL(new RegExp(`/tables/${DATASET_ID.replace(".", "\\.")}`));

  // 2) Table → SQL Workspace, bound to that table's logical name.
  await page.getByRole("link", { name: /^(쿼리|Query)$/ }).click();
  await expect(page).toHaveURL(/\/sql\?/);
  await expect(page.getByRole("treeitem", { name: LOGICAL_NAME })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });

  const editor = page.locator("#sql-editor");
  await editor.fill("SELECT COUNT(*) AS n\nFROM dataset");
  await page.getByRole("button", { name: /^(실행|Run)( |$)/ }).click();
  const footer = page.getByTestId("result-footer");
  await expect(footer).toContainText(saved, { timeout: 30_000 });

  // 3) Save: Builder runs it once more and keeps the snapshot it read.
  const name = `replay-analysis-${stamp}`;
  await page.getByRole("textbox", { name: /^(분석 이름|Analysis name)/ }).fill(name);
  await page.getByRole("button", { name: /^(실행하고 저장|Run and save)$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: name })).toBeVisible({ timeout: 30_000 });

  const listed = (await (await request.get(`${BUILDER_URL}/analyses`)).json()) as {
    analyses: Array<{ analysis_id: string; name: string; bindings: Array<{ table: string; snapshot_id: string }> }>;
  };
  const analysis = listed.analyses.find((item) => item.name === name);
  expect(analysis?.bindings).toEqual([{ table: LOGICAL_NAME, snapshot_id: saved }]);

  // 4) Refresh: the same table is built again, so `current` moves on.
  const refreshed = await buildTable(request, `ui-saved-analysis-b-${stamp}`);
  expect(refreshed).not.toBe(saved);

  // 5) Saved Analyses → Run again reads the saved snapshot, not the refreshed one.
  await openFromMenu(page, /^(저장된 분석|Saved Analyses)$/);
  await expect(page).toHaveURL(/\/analyses$/);
  const heading = page.getByRole("heading", { name });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  const card = heading.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' flex-col ')][1]");
  await card.getByRole("button", { name: /^(다시 실행|Run again)$/ }).click();
  await expect(card.getByText(new RegExp(`^${LOGICAL_NAME.replace(/\./g, "\\.")}@${saved} · rev \\d+$`))).toBeVisible({
    timeout: 30_000,
  });
  await expect(card.getByText(refreshed)).toHaveCount(0);

  await expectNoPageErrors(errors);
});
