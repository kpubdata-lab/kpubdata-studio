import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

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
  await page.getByRole("button", { name: "File Upload" }).first().click();
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

test("빌드 실패 게이트: 파일 없이는 다음 단계 진입이 막힌다 @real-builder", async ({
  page,
}) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // Select File Upload but don't upload file → next step blocked (#250 gate).
  await openCreateTable(page);
  await page.getByRole("button", { name: "File Upload" }).first().click();
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

