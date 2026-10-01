import { expect, test } from "@playwright/test";
import { parse as parseYaml } from "yaml";
import { fromBuilderSpec, serializeSpec, type BuilderSpec } from "../src/features/build-spec/specMapping";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Cross-repo real integration E2E (kpubdata#282 stage 3 scenario, @real-builder tag).
 *
 * Prerequisites: actual Builder must be running (default http://localhost:8000,
 * override with REAL_BUILDER_URL). Run Builder with KPUBDATA_BUILDER_DEV_MODE=true
 * and Studio with VITE_USE_REAL_BUILDER=true dev server
 * (playwright.real.config.ts's webServer injects it).
 *
 * Validation path: Studio UI → fetch → Builder HTTP → dispatch → orchestrator →
 * Builder ingestion(file) → Bronze/Silver/Gold → manifest → response → UI render.
 * File source operates deterministically without external network.
 *
 * Public API source runs with Builder in its replay mode — a recorded fixture is replayed, so
 * no external network or service keys are needed either. The runner starts Builder with
 * `serve --replay` (its bundled fixtures) or `serve --replay-dir` and sets REAL_BUILDER_REPLAY;
 * a Builder without replay support skips this scenario. Studio sets no kpubdata variable and
 * never looks inside another repository (#511, #541).
 */
const BUILDER_URL = process.env.REAL_BUILDER_URL ?? "http://localhost:8000";

// Default suite (mock, npm run test:e2e) does not run this.
test.skip(!process.env.REAL_BUILDER_E2E, "실 Builder 기동 필요 — scripts/run-real-e2e.mjs");

/**
 * Login token exists only in memory store, so full reload (page.goto) clears it —
 * after login, always navigate via SPA links (sidebar).
 */
/** Create Table is an action of Catalog, not a menu item (#423): menu → Catalog → the action. */
async function openCreateTable(page: import("@playwright/test").Page): Promise<void> {
  await navigateViaShell(page, /^(Catalog|카탈로그)$/);
  await page.getByRole("link", { name: /^(Create Table|테이블 만들기)$/ }).first().click();
  await expect(page).toHaveURL(/\/add/);
}

async function navigateViaShell(page: import("@playwright/test").Page, label: RegExp): Promise<void> {
  await page.getByRole("link", { name: label }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);

  // playwright.real.config.ts sets VITE_DEV_BYPASS_AUTH and this suite's Builder runs
  // with KPUBDATA_BUILDER_DEV_MODE=1 — auth is bypassed on both sides, so this suite
  // exercises the data path only, never the OIDC path. Real OIDC E2E is a manual smoke
  // (see README "Keycloak → Builder OIDC smoke").
  await page.goto("/");
});

test("실 Builder /version이 응답한다 (기동 전제) @real-builder", async ({ request }) => {
  const response = await request.get(`${BUILDER_URL}/version`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { service?: string };
  expect(body.service).toBe("kpubdata-builder");
});

test("File Upload → Preview → Build → Builds 이력 전체 경로 @real-builder", async ({
  page,
}) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // 1) Source: File Upload select, proceed to Configure (SPA navigation — token preserved)
  await openCreateTable(page);
  await page.getByRole("button", { name: "파일 업로드" }).first().click();
  await page.getByRole("button", { name: "다음" }).first().click();

  // 2) Configure: format csv + actual file upload (real Builder POST /uploads)
  await expect(page.getByRole("heading", { name: "가져오기 설정" })).toBeVisible();
  await page.getByLabel("포맷 (Format)").selectOption("csv");
  const fileInput = page.getByLabel("파일");
  await fileInput.setInputFiles({
    name: "cross-e2e.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name,value\n1,alpha,10\n2,beta,20\n3,gamma,30\n", "utf8"),
  });
  // Wait for actual POST /uploads completion indicator (distinguish from "uploading").
  await expect(page.getByText(/업로드 완료: cross-e2e\.csv/).first()).toBeVisible({
    timeout: 30_000,
  });

  // 3) Preview & Validate step — calls real Builder /preview·/validate
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.getByRole("heading", { name: "Preview · 검증" })).toBeVisible();
  await page.getByRole("button", { name: "Preview 새로고침" }).first().click();
  await expect(page.getByText("검증 결과 (Validation)")).toBeVisible({ timeout: 30_000 });
  // File source without quality checks displays "Not evaluated / N/A" (#516 principle).
  await expect(
    page.getByText(/Not evaluated|checks passed/).first(),
  ).toBeVisible({ timeout: 30_000 });

  // 4) Review & Build — show canonical BuildSpec, then real POST /build
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.getByRole("heading", { name: "검토 · 테이블 만들기" })).toBeVisible();
  const buildButton = page.getByRole("button", { name: "테이블 만들기" });
  // Enabled if validation passes + preview not stale (#250 gate).
  await expect(buildButton).toBeEnabled({ timeout: 30_000 });
  await buildButton.click();

  // 5) The upload builds end to end. It used to end in a structured failure because
  // the file source's async run did not pass its owner; the Builder now does, so the
  // wizard lands on the new run's detail, succeeded.
  await expect(page).toHaveURL(/\/refresh-jobs\/[^/?]+/, { timeout: 60_000 });
  await expect(page.getByText("성공").and(page.locator(":visible")).first()).toBeVisible({ timeout: 60_000 });

  // 6) The run history (real GET /builds) has it.
  await navigateViaShell(page, /^(Refresh History|갱신 이력)$/);
  await expect(page.getByRole("heading", { name: /갱신 이력|Refresh History/i }).first()).toBeVisible();

  await expectNoPageErrors(errors);
});

/**
 * Public API source BuildSpec. Must match the replay fixture's dataset and params exactly
 * (fixture is `datago.air_station` example `gangnam_full_page`).
 * totalCount 22 ≤ page_size 100, so finishes in one page — Builder Bronze walks pages
 * with `list_all()`, replay fails if 2-page fixture missing.
 */
const PUBLIC_API_SPEC = [
  "dataset_id: dataset.cross_repo_public_api",
  "title: Cross-repo Public API smoke",
  "description: replay fixture를 실 Builder HTTP로 빌드한다",
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

test("Public API source가 Builder 를 거쳐 성공 빌드로 끝난다 @real-builder", async ({
  page,
  request,
}) => {
  // Deterministic only when Builder runs in replay mode — the runner sets REAL_BUILDER_REPLAY
  // when the Builder it started supports `serve --replay` (kpubdata-builder#837).
  test.skip(
    !process.env.REAL_BUILDER_REPLAY,
    "Builder replay 모드 필요 — scripts/run-real-e2e.mjs 로 kpubdata-builder#837 이후 Builder 를 띄우세요",
  );

  const errors: string[] = [];
  collectPageErrors(page, errors);

  // 1) Submit real Builder Public API BuildSpec from browser context.
  //    File source scenario already covers wizard UI path, so here validates previously
  //    untested section — Builder's public-API ingestion → Bronze/Silver/Gold — via real HTTP.
  const runId = `ui-public-api-${Date.now()}`;
  const response = await request.post(`${BUILDER_URL}/build`, {
    data: { spec: PUBLIC_API_SPEC, run_id: runId },
    timeout: 60_000,
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    status?: string;
    outcomes?: Array<{ status?: string; stages_completed?: string[]; error?: string | null }>;
  };
  expect(body.status).toBe("ok");
  const outcome = body.outcomes?.[0];
  expect(outcome?.error ?? null).toBeNull();
  // The fetched records must pass all three stages.
  expect(outcome?.stages_completed).toEqual(["bronze", "silver", "gold"]);

  // 2) Studio actually renders that run (real GET /builds/{run_id} path).
  await page.goto(`/refresh-jobs/${runId}`);
  await expect(
    page
      .getByText(runId)
      .first()
      .or(page.getByText(/Cross-repo Public API smoke/).first()),
  ).toBeVisible({ timeout: 30_000 });

  await expectNoPageErrors(errors);
});

/**
 * The same replay source without an alias (#602): Builder keys it `datago.air_station`, so
 * the warehouse table is `<dataset_id>.datago.air_station`. The dataset id has a dot too.
 */
const NO_ALIAS_DATASET_ID = "dataset.cross_repo_no_alias";
const NO_ALIAS_TITLE = "Cross-repo Public API without alias";
const NO_ALIAS_SPEC = [
  `dataset_id: ${NO_ALIAS_DATASET_ID}`,
  `title: ${NO_ALIAS_TITLE}`,
  "description: alias 없는 replay source 의 테이블을 목록에서 상세로 연다",
  "sources:",
  "  - provider: datago",
  "    dataset: air_station",
  "    params:",
  "      station: 강남구",
  "      term: daily",
  "      page: 1",
  "      page_size: 100",
  "exports:",
  "  - kind: jsonl",
  "    output_path: out/data.jsonl",
].join("\n");

test("alias 없는 Public API source 의 테이블을 목록에서 열면 현재 스냅샷과 행이 보인다 (#602) @real-builder", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.REAL_BUILDER_REPLAY,
    "Builder replay 모드 필요 — scripts/run-real-e2e.mjs 로 kpubdata-builder#837 이후 Builder 를 띄우세요",
  );

  const errors: string[] = [];
  collectPageErrors(page, errors);

  const response = await request.post(`${BUILDER_URL}/build`, {
    data: { spec: NO_ALIAS_SPEC, run_id: `ui-no-alias-${Date.now()}` },
    timeout: 60_000,
  });
  expect(response.ok()).toBeTruthy();
  expect(((await response.json()) as { status?: string }).status).toBe("ok");

  // What Builder committed: the table's name keeps the whole `datago.air_station` key.
  const logicalName = `${NO_ALIAS_DATASET_ID}.datago.air_station`;
  const warehouse = (await (await request.get(`${BUILDER_URL}/warehouse/tables`)).json()) as {
    tables: Array<{ logical_name: string; current_snapshot_id: string | null; dataset_id?: string | null }>;
  };
  const table = warehouse.tables.find((entry) => entry.logical_name === logicalName);
  expect(table?.current_snapshot_id, `${logicalName} has a committed snapshot`).toBeTruthy();
  const snapshotId = table?.current_snapshot_id ?? "";

  // 1) The Tables list shows the snapshot on the dataset's row, and the row opens it.
  await page.goto("/tables");
  const row = page.getByRole("link", { name: t("catalog.openDetail").replace("{{title}}", NO_ALIAS_TITLE) });
  await expect(row).toContainText(snapshotId, { timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/tables/${NO_ALIAS_DATASET_ID.replace(".", "\\.")}$`));

  // 2) The detail opens on the same current snapshot, not on the run view.
  await expect(page.getByRole("tabpanel")).toContainText(snapshotId, { timeout: 30_000 });
  await expect(page.getByText(t("tableDetail.runView.noSnapshot"))).toHaveCount(0);

  // 3) Preview reads that snapshot's rows from the warehouse.
  const rows = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/warehouse/rows") && candidate.request().method() === "POST",
  );
  await page.getByRole("tab", { name: t("tableDetail.tabs.preview") }).click();
  const rowsResponse = await rows;
  expect(rowsResponse.ok()).toBeTruthy();
  const body = (await rowsResponse.json()) as { snapshot: { logical_name: string; snapshot_id: string }; rows: unknown[] };
  expect(body.snapshot).toMatchObject({ logical_name: logicalName, snapshot_id: snapshotId });
  expect(body.rows.length).toBeGreaterThan(0);
  await expect(page.getByTestId("row-total")).toBeVisible();

  await expectNoPageErrors(errors);
});

/**
 * The same replay fixture, but `station` comes from `param_grid` (one combination, so the
 * replayed call is unchanged) and the BuildSpec declares `dataTime` PII in `gold` (#601).
 * If Studio's mapping drops `param_grid` the source fails for a missing station; if it
 * drops `gold`, Gold publishes the column unmasked.
 */
const PII_ROUND_TRIP_YAML = [
  "dataset_id: dataset.cross_repo_pii_round_trip",
  "title: Cross-repo PII round trip",
  "description: BuildSpec에만 선언한 PII가 Studio 왕복 후에도 Gold에서 가려진다",
  "sources:",
  "  - provider: datago",
  "    dataset: air_station",
  "    alias: measurements",
  "    params:",
  "      term: daily",
  "      page: 1",
  "      page_size: 100",
  "    param_grid:",
  "      station: [강남구]",
  "    gold:",
  "      pii_columns: [dataTime]",
  "exports:",
  "  - kind: jsonl",
  "    output_path: out/data.jsonl",
].join("\n");

test("BuildSpec 선언 PII가 Studio 편집→제출 왕복 뒤 Gold에서 가려진다 (#601) @real-builder", async ({
  request,
}) => {
  test.skip(
    !process.env.REAL_BUILDER_REPLAY,
    "Builder replay 모드 필요 — scripts/run-real-e2e.mjs 로 kpubdata-builder#837 이후 Builder 를 띄우세요",
  );

  // 1) Studio's own mapping: Builder YAML → Studio BuildSpec → a form edit → the payload
  //    Studio submits (the same serializeSpec the Add Data and New Build flows use).
  const loaded = fromBuilderSpec(parseYaml(PII_ROUND_TRIP_YAML) as BuilderSpec);
  const edited = { ...loaded, title: "Cross-repo PII round trip (edited)" };
  const payload = serializeSpec(edited);
  expect(JSON.parse(payload)).toMatchObject({
    title: "Cross-repo PII round trip (edited)",
    sources: [{ param_grid: { station: ["강남구"] }, gold: { pii_columns: ["dataTime"] } }],
  });

  // 2) Real Builder builds it end to end.
  const runId = `ui-pii-round-trip-${Date.now()}`;
  const response = await request.post(`${BUILDER_URL}/build`, {
    data: { spec: payload, run_id: runId },
    timeout: 60_000,
  });
  const body = (await response.json()) as {
    status?: string;
    outcomes?: Array<{ error?: string | null; stages_completed?: string[] }>;
  };
  expect(body.status).toBe("ok");
  expect(body.outcomes?.[0]?.error ?? null).toBeNull();
  expect(body.outcomes?.[0]?.stages_completed).toEqual(["bronze", "silver", "gold"]);

  // 3) The declaration reached Gold: the manifest records it as masked by the BuildSpec…
  const manifestResponse = await request.get(`${BUILDER_URL}/builds/${runId}/manifest`);
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = (await manifestResponse.json()) as {
    pii_masking?: Record<string, { masked?: Array<{ column: string; declared_by: string[] }>; unmasked?: unknown[] }>;
  };
  const masking = manifest.pii_masking?.["measurements"];
  expect(masking?.masked).toEqual([expect.objectContaining({ column: "dataTime", declared_by: ["build_spec"] })]);
  expect(masking?.unmasked).toEqual([]);

  // 4) …and no published Gold row carries the raw value.
  const rowsResponse = await request.post(`${BUILDER_URL}/warehouse/rows`, {
    data: { table: "dataset.cross_repo_pii_round_trip.measurements", page_size: 100 },
  });
  expect(rowsResponse.ok()).toBeTruthy();
  const rows = ((await rowsResponse.json()) as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row["dataTime"] === "[masked]")).toBe(true);
});

test("빌드 실패 게이트: 파일 없이는 다음 단계 진입이 막힌다 @real-builder", async ({
  page,
}) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // Select File Upload but don't upload file → next step blocked (#250 gate).
  await openCreateTable(page);
  await page.getByRole("button", { name: "파일 업로드" }).first().click();
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.getByRole("heading", { name: "가져오기 설정" })).toBeVisible();
  // Still shows Configure step (progress blocked) or explicit error guidance.
  await expect(
    page
      .getByRole("heading", { name: "설정 (Configure)" })
      .or(page.getByText("먼저 포맷을 선택해주세요."))
      .first(),
  ).toBeVisible();

  await expectNoPageErrors(errors);
});

test("다른 릴리스의 Builder 에 붙으면 배너가 뜨고 화면은 막히지 않는다 (#480) @real-builder", async ({ page, request }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  const engine = (await (await request.get(`${BUILDER_URL}/version`)).json()) as { version?: string };
  expect(engine.version, "the Builder reports its application version (kpubdata-builder#777)").toBeTruthy();

  await page.goto("/");
  const banner = page.getByRole("status").filter({ hasText: "Studio 0.3.0" });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText(`KPubData Builder ${engine.version}`);

  // Not blocking: the menu still takes you somewhere, with the banner still there.
  await navigateViaShell(page, /^(Refresh History|갱신 이력)$/);
  await expect(page).toHaveURL(/\/refresh-jobs/);

  await expectNoPageErrors(errors);
});

test("관리자는 관리 메뉴에서 정책·실행·가입 원장을 본다 (#409) @real-builder", async ({ page, request }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // KPUBDATA_BUILDER_DEV_MODE's principal is an administrator, so this is the administrator
  // case against a real Builder. The ledger holds OIDC users only, so a dev-mode Builder
  // answers an empty list — the screen must say so instead of showing nothing. The
  // non-administrator case needs an OIDC principal and is covered with MSW in
  // __tests__/adminScreen.test.tsx.
  const ledger = await request.get(`${BUILDER_URL}/admin/users`);
  expect(ledger.status()).toBe(200);
  const body = (await ledger.json()) as { users: unknown[]; count: number };

  await navigateViaShell(page, /^(Administration|관리)$/);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("ENFORCE_OWNERSHIP")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /사용자 · 가입 승인|Users and sign-up approval/ })).toBeVisible();
  if (body.count === 0) {
    await expect(page.getByText(/아직 로그인한 OIDC 사용자가 없습니다|No OIDC user has signed in yet/)).toBeVisible();
  } else {
    await expect(page.getByRole("table", { name: /^(사용자|Users)$/ })).toBeVisible();
  }
  await expect(page.getByRole("main").last().getByRole("alert")).toHaveCount(0);

  await expectNoPageErrors(errors);
});

