import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectNoPageErrors, t } from "./helpers";

/**
 * Studio against a multi-user Builder (#773, tag `@multi-user`).
 *
 * `real-builder.spec.ts` runs with authentication bypassed on both sides, which is one
 * user whose provider keys the server holds. Here Builder verifies OIDC tokens, keeps
 * every user's runs apart and takes provider keys with each request only, and Studio
 * signs in through keycloak-js — the deployment people are invited to. The identity
 * provider is a stand-in started by `scripts/multi-user-e2e.mjs`, which also checks,
 * before any browser starts, that Builder refuses a request without a token.
 *
 * Public-API calls are answered by Builder's replay fixtures, so the key typed here is
 * never sent anywhere: what is checked is that Studio sends it and Builder asks for it.
 */
const BUILDER_URL = process.env.REAL_BUILDER_URL ?? "http://localhost:8903";

test.skip(!process.env.MULTI_USER_E2E, "multi-user Builder needed — scripts/run-real-e2e.mjs starts one");

const ALICE = "e2e-alice";
const BOB = "e2e-bob";
/**
 * The provider key Alice types. Not a real key — replay answers for the provider — but a
 * value of this run only, made by the runner around the workflow's canary, so that it is
 * found by value if it ever reaches Builder's output, a response to Bob or the evidence of
 * a failed run.
 */
const SESSION_KEY = process.env.MULTI_USER_SESSION_KEY ?? "e2e-canary-local-key-alice-session";

/** Sign in as a user of the test realm, the way the login page does it. */
async function signIn(page: Page, userId: string): Promise<void> {
  await page.goto("/");
  // Where Studio is, before the identity provider is anywhere in the address.
  const studio = new URL(page.url()).origin;
  await page.getByRole("button", { name: t("auth.page.emailLogin") }).click();
  await page.locator(`[data-fake-user="${userId}"]`).click();
  await page.waitForURL((url) => url.origin === studio && !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible({ timeout: 30_000 });
}

/**
 * The session's tokens live in memory, so a full reload would sign the user out of this
 * tab: every move after sign-in goes through the shell's links.
 */
async function openFromMenu(page: Page, label: RegExp): Promise<void> {
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: label }).first().click();
}

async function openCreateTable(page: Page): Promise<void> {
  await openFromMenu(page, /^(Catalog|카탈로그)$/);
  await page.getByRole("link", { name: /^(Create Table|테이블 만들기)$/ }).first().click();
  await expect(page).toHaveURL(/\/add/);
}

/** Enter the datago key on the Connections page, for this session: this Builder stores none. */
async function enterSessionKey(page: Page): Promise<void> {
  await openFromMenu(page, /^(Connections|연결)$/);
  await page.getByRole("button", { name: `${t("provider.table.manage")} — datago` }).click();
  await expect(page.getByText(t("provider.detail.perRequestTitle"))).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: t("provider.detail.enterSessionKey") }).click();
  await page.getByPlaceholder(t("provider.detail.keyPlaceholder")).fill(SESSION_KEY);
  await page.getByRole("button", { name: t("provider.detail.useForSession") }).click();
  await expect(page.getByText(t("provider.detail.sessionKeyHeld"))).toBeVisible();
}

/**
 * Page errors, but for the one a signed-in user who is not an administrator always has:
 * Studio asks Builder whether to show the administration menu (`GET /admin/config`), the
 * answer is 403, and the browser logs every failed load. DEV_MODE's one user is an
 * administrator, so the single-user suite never sees it.
 */
function collectSignedInPageErrors(
  page: Page,
  bucket: string[],
  expected404s: () => string[] = () => [],
  expected400s: () => string[] = () => [],
): void {
  page.on("pageerror", (error) => bucket.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const from = message.location().url;
    if (from === `${BUILDER_URL}/admin/config` && message.text().includes("403")) return;
    if (expected404s().includes(from.split("?")[0]) && message.text().includes("404")) return;
    if (expected400s().includes(from.split("?")[0]) && message.text().includes("400")) return;
    bucket.push(`console.error: ${message.text()} (${from})`);
  });
}

/** Every `GET /providers` Studio sends, with whether it carried a provider key. */
function watchProviderLists(page: Page): Array<{ carriedKey: boolean }> {
  const seen: Array<{ carriedKey: boolean }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(BUILDER_URL).origin && request.method() === "GET" && url.pathname === "/providers") {
      seen.push({ carriedKey: (request.headers()["x-provider-key"] ?? "").startsWith("datago=") });
    }
  });
  return seen;
}

// No `prepareCleanPage` here: it clears localStorage on every document, the hidden
// sign-in frame included, and keycloak-js keeps the state of a sign-in in progress there.
// Each test's browser context starts with empty storage anyway.

test("로그인한 사용자가 키를 넣으면 테이블 만들기가 막히지 않고 미리보기까지 간다 (#767) @multi-user", async ({ page }) => {
  test.skip(!process.env.REAL_BUILDER_REPLAY, "Builder replay 모드 필요");
  const errors: string[] = [];
  collectSignedInPageErrors(page, errors);
  const providerLists = watchProviderLists(page);

  await signIn(page, ALICE);

  // 1) No key yet: a multi-user Builder holds none for this user, and Add Data says so.
  await openCreateTable(page);
  await page.getByRole("button", { name: /공공 API/ }).first().click();
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.locator('#add-data-provider option[value="datago"]')).toBeAttached({ timeout: 30_000 });
  await page.locator("#add-data-provider").selectOption("datago");
  await page.locator("#add-data-dataset").selectOption("air_station");
  await expect(page.getByText(t("addData.credential.title"))).toBeVisible({ timeout: 30_000 });

  //    Going on without it does not reach Builder (#787): the preview step says the same
  //    thing instead of sending a request that can only be refused.
  const previewsSent: string[] = [];
  page.on("request", (sent) => {
    if (sent.url() === `${BUILDER_URL}/preview`) previewsSent.push(sent.method());
  });
  await page
    .locator("#add-data-params")
    .fill(JSON.stringify({ station: "강남구", term: "daily", page: 1, page_size: 100 }));
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.getByRole("heading", { name: "미리보기 · 검증" })).toBeVisible();
  await page.getByRole("button", { name: "미리보기 새로고침" }).first().click();
  await expect(page.getByText(t("addData.credential.title")).first()).toBeVisible();
  await expect(page.getByText("검증 결과 (Validation)")).toHaveCount(0);
  expect(previewsSent, "no preview is sent without the key").toEqual([]);

  // 2) The key is entered for this session only: this Builder stores none.
  await enterSessionKey(page);

  // 3) Add Data is not blocked any more — the defect of #767: the provider list was
  //    asked for without the key the user holds, so Builder answered "not configured".
  const listsBefore = providerLists.length;
  await openCreateTable(page);
  await page.getByRole("button", { name: /공공 API/ }).first().click();
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.locator('#add-data-provider option[value="datago"]')).toBeAttached({ timeout: 30_000 });
  await page.locator("#add-data-provider").selectOption("datago");
  await page.locator("#add-data-dataset").selectOption("air_station");
  await page
    .locator("#add-data-params")
    .fill(JSON.stringify({ station: "강남구", term: "daily", page: 1, page_size: 100 }));
  await expect.poll(() => providerLists.slice(listsBefore).some((list) => list.carriedKey)).toBe(true);
  await expect(page.getByText(t("addData.credential.title"))).toHaveCount(0);

  // 4) Preview: Builder takes the key from the request and replay answers for the provider.
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.getByRole("heading", { name: "미리보기 · 검증" })).toBeVisible();
  await page.getByRole("button", { name: "미리보기 새로고침" }).first().click();
  await expect(page.getByText("검증 결과 (Validation)")).toBeVisible({ timeout: 30_000 });

  // The key is in memory only: not in the address, not in anything the browser keeps.
  expect(page.url()).not.toContain(SESSION_KEY);
  const kept = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
  expect(kept).not.toContain(SESSION_KEY);

  await expectNoPageErrors(errors);
});

test("두 사용자는 서로의 실행도 키도 볼 수 없다 @multi-user", async ({ browser, request }) => {
  // 1) Alice enters her provider key, and Builder is sent it with her next provider list.
  const alice = await browser.newContext();
  const alicePage = await alice.newPage();
  const alicesLists = watchProviderLists(alicePage);
  await signIn(alicePage, ALICE);
  await enterSessionKey(alicePage);

  //    She makes a table from a file.
  await openCreateTable(alicePage);
  await expect.poll(() => alicesLists.some((list) => list.carriedKey)).toBe(true);
  await alicePage.getByRole("button", { name: "파일 업로드" }).first().click();
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  await alicePage.getByLabel("포맷 (Format)").selectOption("csv");
  const fileName = `alice-only-${Date.now()}.csv`;
  await alicePage.getByLabel("파일").setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from("id,name\n1,alpha\n2,beta\n", "utf8"),
  });
  await expect(alicePage.getByText(`업로드 완료: ${fileName}`).first()).toBeVisible({ timeout: 30_000 });
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  await alicePage.getByRole("button", { name: "미리보기 새로고침" }).first().click();
  await expect(alicePage.getByText("검증 결과 (Validation)")).toBeVisible({ timeout: 30_000 });
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  const build = alicePage.getByRole("button", { name: "테이블 만들기" });
  await expect(build).toBeEnabled({ timeout: 30_000 });
  await build.click();
  await expect(alicePage).toHaveURL(/\/refresh-jobs\/[^/?]+(\?|$)/, { timeout: 60_000 });
  const runId = decodeURIComponent(new URL(alicePage.url()).pathname.split("/").pop() ?? "");
  expect(runId).not.toBe("");
  await expect(alicePage.getByText("성공").and(alicePage.locator(":visible")).first()).toBeVisible({ timeout: 60_000 });

  // 2) Bob signs in to the same Builder, in a browser of his own.
  const bob = await browser.newContext();
  const bobPage = await bob.newPage();
  const bobsToken = bobPage
    .waitForRequest((sent) => sent.url().startsWith(BUILDER_URL) && Boolean(sent.headers()["authorization"]))
    .then((sent) => sent.headers()["authorization"]);
  await signIn(bobPage, BOB);

  // His run history has been asked for, has answered, and does not have her run…
  const bobsHistory = bobPage.waitForResponse(
    (answer) => answer.url().startsWith(`${BUILDER_URL}/builds`) && answer.request().method() === "GET" && answer.ok(),
  );
  await openFromMenu(bobPage, /^(Refresh History|갱신 이력)$/);
  await expect(bobPage.getByRole("heading", { name: /갱신 이력|Refresh History/i }).first()).toBeVisible();
  expect(await (await bobsHistory).text()).not.toContain(runId);
  await expect(bobPage.getByText(runId)).toHaveCount(0);

  // …and Builder answers him as it would for a run that does not exist, by every way
  // to it: the run, its manifest, its spec. Hers is still there for her.
  const authorization = await bobsToken;
  for (const path of [`/builds/${runId}`, `/builds/${runId}/manifest`, `/builds/${runId}/spec`]) {
    const answer = await request.get(`${BUILDER_URL}${path}`, { headers: { Authorization: authorization } });
    expect(answer.status(), `${path} as Bob`).toBe(404);
  }
  const listed = await request.get(`${BUILDER_URL}/builds?limit=200`, { headers: { Authorization: authorization } });
  expect(listed.ok()).toBeTruthy();
  const listedText = await listed.text();
  expect(listedText).not.toContain(runId);

  // 3) Her key is hers. Builder holds it for her request only: it does not answer Bob as
  //    if he had one, and the key is in nothing he is sent.
  const bobsProviders = await request.get(`${BUILDER_URL}/providers`, { headers: { Authorization: authorization } });
  expect(bobsProviders.ok()).toBeTruthy();
  const providersText = await bobsProviders.text();
  const datago = (JSON.parse(providersText) as { providers: Array<{ provider: string; configured: boolean }> }).providers.find(
    (provider) => provider.provider === "datago",
  );
  expect(datago, "datago in Bob's provider list").toBeDefined();
  expect(datago?.configured, "datago is not usable by Bob on Alice's key").toBe(false);
  for (const [what, text] of [["GET /providers", providersText], ["GET /builds", listedText]] as const) {
    expect(text.includes(SESSION_KEY), `Alice's key in Bob's ${what}`).toBe(false);
  }

  await openFromMenu(alicePage, /^(Refresh History|갱신 이력)$/);
  await expect(alicePage.getByText(runId).first()).toBeVisible({ timeout: 30_000 });

  await alice.close();
  await bob.close();
});

test("두 계정의 테이블·업로드·저장된 분석·내보내기와 브라우저에 둔 초안은 서로 닿지 않는다 (#773) @multi-user", async ({
  browser,
  request,
}) => {
  const stamp = Date.now();
  const datasetId = `e2e.alice-private-${stamp}`;
  const tableTitle = `Alice private ${stamp}`;

  // 1) Alice signs in, and makes one of everything Builder keeps for a user: an upload,
  //    a run, the warehouse table it commits, a saved analysis and an export.
  const alice = await browser.newContext();
  cleanups.push(() => alice.close());
  const alicePage = await alice.newPage();
  const alicesToken = nextBuilderToken(alicePage);
  await signIn(alicePage, ALICE);
  const aliceAuth = { Authorization: await alicesToken };

  const upload = await request.post(`${BUILDER_URL}/uploads?format=csv&filename=alice-private.csv`, {
    headers: { ...aliceAuth, "Content-Type": "application/octet-stream" },
    data: Buffer.from("id,name\n1,alpha\n2,beta\n", "utf8"),
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const { upload_id: uploadId } = (await upload.json()) as { upload_id: string };
  const spec = [
    `dataset_id: ${datasetId}`,
    `title: ${tableTitle}`,
    "description: Only Alice may see this",
    "sources:",
    "  - kind: file",
    `    upload_id: ${uploadId}`,
    "    format: csv",
    "    alias: rows",
    "exports:",
    "  - kind: jsonl",
    "    output_path: data.jsonl",
  ].join("\n");
  const built = await request.post(`${BUILDER_URL}/build`, { headers: aliceAuth, data: { spec }, timeout: 60_000 });
  expect(built.status(), await built.text()).toBe(200);
  const runId = ((await built.json()) as { run_id: string }).run_id;

  type Table = { logical_name: string; current_snapshot_id: string | null };
  const tablesOf = async (auth: Record<string, string>): Promise<Table[]> => {
    const answer = await request.get(`${BUILDER_URL}/warehouse/tables`, { headers: auth });
    expect(answer.status(), "GET /warehouse/tables").toBe(200);
    return ((await answer.json()) as { tables: Table[] }).tables;
  };
  const table = (await tablesOf(aliceAuth)).find((entry) => entry.logical_name.startsWith(`${datasetId}.`));
  expect(table?.current_snapshot_id, "Alice's build committed a table").toBeTruthy();
  const tableName = table?.logical_name ?? "";

  const saved = await request.post(`${BUILDER_URL}/analyses`, {
    headers: aliceAuth,
    data: { name: `alice-analysis-${stamp}`, table: tableName, sql: "SELECT COUNT(*) AS n FROM dataset" },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  const analysisId = ((await saved.json()) as { analysis: { analysis_id: string } }).analysis.analysis_id;
  expect(analysisId).toBeTruthy();

  const exported = await request.post(`${BUILDER_URL}/warehouse/exports`, {
    headers: aliceAuth,
    data: { table: tableName, sql: "SELECT * FROM dataset", format: "csv" },
  });
  expect(exported.status(), await exported.text()).toBe(200);
  const exportId = ((await exported.json()) as { export_id: string }).export_id;

  // 2) Bob signs in, in a browser of his own.
  const bob = await browser.newContext();
  cleanups.push(() => bob.close());
  const bobPage = await bob.newPage();
  const bobsToken = nextBuilderToken(bobPage);
  await signIn(bobPage, BOB);
  const bobAuth = { Authorization: await bobsToken };

  //    None of it is in anything Builder lists for him…
  const lists: Array<[string, string[]]> = [
    ["/builds?limit=200", [runId, datasetId]],
    ["/warehouse/tables", [tableName, datasetId]],
    ["/uploads", [uploadId, "alice-private.csv"]],
    ["/analyses", [analysisId, `alice-analysis-${stamp}`]],
    ["/warehouse/exports", [exportId, tableName]],
  ];
  for (const [path, hers] of lists) {
    const mine = await request.get(`${BUILDER_URL}${path}`, { headers: aliceAuth });
    expect(mine.status(), `${path} as Alice`).toBe(200);
    // The check below is worth something only if her list does name it.
    expect(await mine.text(), `${path} as Alice names ${hers[0]}`).toContain(hers[0]);
    const his = await request.get(`${BUILDER_URL}${path}`, { headers: bobAuth });
    expect(his.status(), `${path} as Bob`).toBe(200);
    const text = await his.text();
    for (const value of hers) expect(text.includes(value), `${value} in Bob's ${path}`).toBe(false);
  }

  //    …and every way to it by name answers him as it would for something that is not there.
  const table404 = encodeURIComponent(tableName);
  const reads: Array<[string, string, unknown?]> = [
    ["GET", `/builds/${encodeURIComponent(runId)}`],
    ["GET", `/builds/${encodeURIComponent(runId)}/manifest`],
    ["GET", `/builds/${encodeURIComponent(runId)}/spec`],
    ["GET", `/builds/${encodeURIComponent(runId)}/events`],
    ["GET", `/warehouse/tables/${table404}`],
    ["GET", `/warehouse/tables/${table404}/profile`],
    ["POST", "/warehouse/rows", { table: tableName }],
    ["POST", "/warehouse/query", { table: tableName, sql: "SELECT * FROM dataset" }],
    ["POST", "/warehouse/exports", { table: tableName, sql: "SELECT * FROM dataset", format: "csv" }],
    ["POST", "/analyses", { name: "bob-reads-alice", table: tableName, sql: "SELECT * FROM dataset" }],
    ["GET", `/uploads/${uploadId}`],
    ["DELETE", `/uploads/${uploadId}`],
    ["GET", `/analyses/${analysisId}`],
    ["POST", `/analyses/${analysisId}/run`, {}],
    ["DELETE", `/analyses/${analysisId}`],
    ["GET", `/warehouse/exports/${exportId}`],
    ["GET", `/warehouse/exports/${exportId}/download`],
    ["DELETE", `/warehouse/exports/${exportId}`],
  ];
  for (const [method, path, data] of reads) {
    const answer = await request.fetch(`${BUILDER_URL}${path}`, { method, headers: bobAuth, data });
    expect(answer.status(), `${method} ${path} as Bob: ${await answer.text()}`).toBe(404);
  }
  //    A build of his that names her upload does not read it either.
  const borrowed = await request.post(`${BUILDER_URL}/build`, {
    headers: bobAuth,
    data: { spec: spec.replace(datasetId, `e2e.bob-borrows-${stamp}`) },
    timeout: 60_000,
  });
  expect(borrowed.ok(), `Bob's build on Alice's upload: ${borrowed.status()}`).toBe(false);
  expect(await borrowed.text()).not.toContain("alpha");

  //    What he tried deleted nothing of hers.
  for (const path of [`/uploads/${uploadId}`, `/analyses/${analysisId}`, `/warehouse/exports/${exportId}`]) {
    expect((await request.get(`${BUILDER_URL}${path}`, { headers: aliceAuth })).status(), `${path} as Alice`).toBe(200);
  }

  // 3) There is no way around the token: this Builder has no API key, and a request that
  //    carries one instead of a token is refused before anything is listed.
  for (const path of ["/builds", "/warehouse/tables", "/uploads", "/analyses", "/warehouse/exports", "/providers"]) {
    const withoutAToken: Array<Record<string, string>> = [
      { "X-API-Key": "anything" },
      { Authorization: "Bearer anything" },
      { "X-User-Id": ALICE },
    ];
    for (const headers of withoutAToken) {
      const answer = await request.get(`${BUILDER_URL}${path}`, { headers });
      expect(answer.status(), `GET ${path} with ${Object.keys(headers)[0]}`).toBe(401);
      expect(await answer.text()).not.toContain(datasetId);
    }
  }

  // 4) In Studio, his Tables page has been answered and does not show her table.
  const bobsTables = bobPage.waitForResponse(
    (answer) => answer.url() === `${BUILDER_URL}/warehouse/tables` && answer.ok(),
  );
  await openFromMenu(bobPage, /^(Tables|테이블)$/);
  await bobsTables;
  await expect(bobPage.getByText(tableTitle)).toHaveCount(0);

  // 5) The same browser, another account. Alice leaves a table half made — Studio keeps
  //    that draft in this browser — and signs out; Bob signs in where she was.
  const draftTitle = `alice-draft-${stamp}`;
  await openCreateTable(alicePage);
  await alicePage.getByRole("button", { name: "파일 업로드" }).first().click();
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  await alicePage.getByText(t("addData.configure.advancedTitle")).click();
  await alicePage.locator("#add-data-title").fill(draftTitle);
  await alicePage.getByRole("button", { name: t("addData.nav.saveDraft") }).click();
  await expect
    .poll(() => alicePage.evaluate(() => JSON.stringify({ ...localStorage })))
    .toContain(draftTitle);

  const studio = new URL(alicePage.url()).origin;
  await alicePage.getByRole("button", { name: /계정 메뉴/ }).click();
  await alicePage.getByRole("button", { name: t("layout.account.signOut") }).click();
  await alicePage.waitForURL((url) => url.origin === studio && url.pathname.startsWith("/login"), { timeout: 30_000 });
  await signIn(alicePage, BOB);

  //    He starts a table of his own and is not offered hers: no saved draft waits for him,
  //    and the form is empty.
  await openCreateTable(alicePage);
  await expect(alicePage.getByText(t("addData.draft.prompt"))).toHaveCount(0);
  await alicePage.getByRole("button", { name: "파일 업로드" }).first().click();
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  await alicePage.getByText(t("addData.configure.advancedTitle")).click();
  await expect(alicePage.locator("#add-data-title")).toBeVisible();
  await expect(alicePage.locator("#add-data-title")).not.toHaveValue(draftTitle);
  await expect(alicePage.getByText(draftTitle)).toHaveCount(0);
  //    Her draft is not gone, only kept apart: Studio files what a browser keeps under the
  //    account it belongs to, so it is still in this browser's storage under hers, and
  //    it is offered to her again when she signs back in.
  await alicePage.getByRole("button", { name: /계정 메뉴/ }).click();
  await alicePage.getByRole("button", { name: t("layout.account.signOut") }).click();
  await alicePage.waitForURL((url) => url.origin === studio && url.pathname.startsWith("/login"), { timeout: 30_000 });
  await signIn(alicePage, ALICE);
  await openCreateTable(alicePage);
  await expect(alicePage.getByText(t("addData.draft.prompt"))).toBeVisible();
  await alicePage.getByRole("button", { name: t("addData.draft.restore") }).click();
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  await alicePage.getByText(t("addData.configure.advancedTitle")).click();
  await expect(alicePage.locator("#add-data-title")).toHaveValue(draftTitle);
});

/**
 * Builder's answers for a missing key, as recorded for the unit test that plays them back
 * through Studio's client (`missingProviderKey.recorded.test.ts`, #787). What this Builder
 * answers is compared with them here, so the recording cannot drift from Builder unseen.
 * Read from the file: a JSON import needs an import attribute in Playwright's loader.
 */
const RECORDED = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../src/shared/lib/__recordings__/missingProviderKey.json", import.meta.url)),
    "utf8",
  ),
) as {
  refusals: Array<{ call: string; status: number; body: Record<string, unknown> }>;
  keysLostJob: Record<string, unknown>;
};

function recordedRefusal(call: string, status: number): Record<string, unknown> {
  const found = RECORDED.refusals.find((refusal) => refusal.call === call && refusal.status === status);
  if (!found) throw new Error(`no recording of ${call} answering ${status}`);
  return found.body;
}

/** How long this Builder keeps a waiting job's provider keys (`scripts/multi-user-e2e.mjs`). */
const JOB_KEY_TTL_MS = Number(process.env.MULTI_USER_JOB_KEY_TTL_SECONDS ?? "1") * 1000;

type Job = { run_id: string; status: string; code?: string | null };

/** The table id Add Data gives `datago` / `air_station`. */
const DATASET_ID = "datago-air-station";

/** The bearer token a signed-in page sends to Builder, taken from its next request there. */
function nextBuilderToken(page: Page): Promise<string> {
  return page
    .waitForRequest((sent) => sent.url().startsWith(BUILDER_URL) && Boolean(sent.headers()["authorization"]))
    .then((sent) => sent.headers()["authorization"]);
}

/**
 * Open `path` in a new tab of `context`, signed in as `userId`. The tab starts without the
 * other tabs' in-memory tokens, so the login gate sends it to sign in and back to `path`.
 * The identity provider's session in this browser usually signs it in on its own (the
 * silent check); the login button and the user list are there for when it does not.
 */
async function openInNewTab(
  context: BrowserContext,
  userId: string,
  path: string,
  errors: string[],
  expected404s: () => string[],
  expected400s: () => string[] = () => [],
): Promise<Page> {
  const page = await context.newPage();
  collectSignedInPageErrors(page, errors, expected404s, expected400s);
  await page.goto(path);
  const studio = new URL(page.url()).origin;
  const arrived = (url: URL) => url.origin === studio && url.pathname === path;
  const signedInOnItsOwn = await page.waitForURL(arrived, { timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  if (!signedInOnItsOwn) {
    await page.getByRole("button", { name: t("auth.page.emailLogin") }).click();
    await page.waitForURL((url) => arrived(url) || url.origin !== studio, { timeout: 30_000 });
    if (!arrived(new URL(page.url()))) await page.locator(`[data-fake-user="${userId}"]`).click();
    await page.waitForURL(arrived, { timeout: 30_000 });
  }
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible({ timeout: 30_000 });
  return page;
}

test("새로고침하면 입력한 키는 사라지고, 다시 넣으면 미리보기가 된다 (#773) @multi-user", async ({ browser }) => {
  test.skip(!process.env.REAL_BUILDER_REPLAY, "Builder replay 모드 필요");
  const alice = await browser.newContext();
  cleanups.push(() => alice.close());
  const page = await alice.newPage();
  const errors: string[] = [];
  collectSignedInPageErrors(page, errors);
  await signIn(page, ALICE);
  await enterSessionKey(page);

  // 1) She reloads the page. The tokens and the key lived in the memory of the page load
  //    before: the identity provider's session in this browser signs her in again, and
  //    nothing gives the key back.
  const studio = new URL(page.url()).origin;
  await page.reload();
  const back = (url: URL) => url.origin === studio && url.pathname === "/connections";
  const signedInOnItsOwn = await page.waitForURL(back, { timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  if (!signedInOnItsOwn) {
    await page.getByRole("button", { name: t("auth.page.emailLogin") }).click();
    await page.waitForURL((url) => back(url) || url.origin !== studio, { timeout: 30_000 });
    if (!back(new URL(page.url()))) await page.locator(`[data-fake-user="${ALICE}"]`).click();
    await page.waitForURL(back, { timeout: 30_000 });
  }
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible({ timeout: 30_000 });
  const providerLists = watchProviderLists(page);

  //    Connections does not claim a key it no longer has…
  await page.getByRole("button", { name: `${t("provider.table.manage")} — datago` }).click();
  await expect(page.getByText(t("provider.detail.perRequestTitle"))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(t("provider.detail.sessionKeyHeld"))).toHaveCount(0);
  await expect(page.getByRole("button", { name: t("provider.detail.enterSessionKey") })).toBeVisible();

  //    …and Add Data asks for it again instead of sending a request that would be refused.
  const previewsSent: Array<string | undefined> = [];
  page.on("request", (sent) => {
    if (sent.url() === `${BUILDER_URL}/preview`) previewsSent.push(sent.headers()["x-provider-key"]);
  });
  await openCreateTable(page);
  await page.getByRole("button", { name: /공공 API/ }).first().click();
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.locator('#add-data-provider option[value="datago"]')).toBeAttached({ timeout: 30_000 });
  await page.locator("#add-data-provider").selectOption("datago");
  await page.locator("#add-data-dataset").selectOption("air_station");
  await expect(page.getByText(t("addData.credential.title"))).toBeVisible({ timeout: 30_000 });
  expect(providerLists.some((list) => list.carriedKey), "no provider list carried a key after the reload").toBe(false);
  expect(previewsSent).toEqual([]);

  // 2) She gives the key again, and the same steps go through.
  await enterSessionKey(page);
  await openCreateTable(page);
  await page.getByRole("button", { name: /공공 API/ }).first().click();
  await page.getByRole("button", { name: "다음" }).first().click();
  await expect(page.locator('#add-data-provider option[value="datago"]')).toBeAttached({ timeout: 30_000 });
  await page.locator("#add-data-provider").selectOption("datago");
  await page.locator("#add-data-dataset").selectOption("air_station");
  await page
    .locator("#add-data-params")
    .fill(JSON.stringify({ station: "강남구", term: "daily", page: 1, page_size: 100 }));
  await expect(page.getByText(t("addData.credential.title"))).toHaveCount(0);
  await page.getByRole("button", { name: "다음" }).first().click();
  await page.getByRole("button", { name: "미리보기 새로고침" }).first().click();
  await expect(page.getByText("검증 결과 (Validation)")).toBeVisible({ timeout: 30_000 });
  expect(previewsSent).toEqual([`datago=${SESSION_KEY}`]);

  //    Still nowhere the browser keeps things.
  const kept = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
  expect(kept).not.toContain(SESSION_KEY);

  await expectNoPageErrors(errors);
});

/**
 * A CSV big enough that building it takes Builder several seconds — far longer than this
 * Builder keeps a waiting job's keys. About 17 MB, under Builder's 20 MiB upload limit.
 */
function slowCsv(): Buffer {
  const lines = ["id,name,value,note"];
  for (let i = 0; i < 300_000; i += 1) lines.push(`${i},name-${i},${i * 1.5},some note text for row ${i}`);
  return Buffer.from(lines.join("\n"), "utf8");
}

// What a test registers to undo, run whether it passed or failed: the Builder here has one build
// slot, so a build left running by a failed test would hold every later test up.
const cleanups: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
});

test("대기 중 키가 만료된 실행은 편집 화면에서 키를 다시 넣어 같은 정의의 새 실행으로 성공한다 (#846, #787) @multi-user", async ({
  browser,
  request,
}) => {
  test.skip(!process.env.REAL_BUILDER_REPLAY, "Builder replay 모드 필요");
  // Bob's build has to run to its end before Alice's job reaches a worker.
  test.setTimeout(240_000);

  // 1) Bob, in a browser of his own, is the other user whose build takes the only slot.
  const bob = await browser.newContext();
  cleanups.push(() => bob.close());
  const bobPage = await bob.newPage();
  const bobsToken = nextBuilderToken(bobPage);
  await signIn(bobPage, BOB);
  const bobAuth = { Authorization: await bobsToken };

  // 2) Alice has her key for this session and a public-API table ready to build.
  const alice = await browser.newContext();
  cleanups.push(() => alice.close());
  const alicePage = await alice.newPage();
  const errors: string[] = [];
  let aliceRunId = "";
  // A run that never started has nothing on Builder but its job: its detail and edit pages
  // ask for its stages, quality, spec and manifest, and the edit page for the spec
  // revisions of a table that was never made. The browser logs each of those 404s. Its
  // events answer 200 to its owner, so they are not listed: a 404 there would be a real error.
  const expected404s = () =>
    aliceRunId === ""
      ? []
      : [
          ...["stages", "quality", "spec", "manifest"].map(
            (what) => `${BUILDER_URL}/builds/${encodeURIComponent(aliceRunId)}/${what}`,
          ),
          `${BUILDER_URL}/revisions/spec/${DATASET_ID}`,
          `${BUILDER_URL}/revisions/spec/${DATASET_ID}/history`,
        ];
  collectSignedInPageErrors(alicePage, errors, expected404s);
  const alicesToken = nextBuilderToken(alicePage);
  await signIn(alicePage, ALICE);
  const aliceAuth = { Authorization: await alicesToken };
  await enterSessionKey(alicePage);
  await openCreateTable(alicePage);
  await alicePage.getByRole("button", { name: /공공 API/ }).first().click();
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  await expect(alicePage.locator('#add-data-provider option[value="datago"]')).toBeAttached({ timeout: 30_000 });
  await alicePage.locator("#add-data-provider").selectOption("datago");
  await alicePage.locator("#add-data-dataset").selectOption("air_station");
  await alicePage
    .locator("#add-data-params")
    .fill(JSON.stringify({ station: "강남구", term: "daily", page: 1, page_size: 100 }));
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  await alicePage.getByRole("button", { name: "미리보기 새로고침" }).first().click();
  await expect(alicePage.getByText("검증 결과 (Validation)")).toBeVisible({ timeout: 30_000 });
  await alicePage.getByRole("button", { name: "다음" }).first().click();
  const build = alicePage.getByRole("button", { name: "테이블 만들기" });
  await expect(build).toBeEnabled({ timeout: 30_000 });

  // 3) Bob's long build takes the slot.
  const upload = await request.post(`${BUILDER_URL}/uploads?format=csv&filename=bob-slow.csv`, {
    headers: { ...bobAuth, "Content-Type": "application/octet-stream" },
    data: slowCsv(),
    timeout: 60_000,
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const { upload_id: uploadId } = (await upload.json()) as { upload_id: string };
  const bobsSpec = [
    "dataset_id: e2e.bob-slow",
    "title: Bob's slow build",
    "description: Keeps the one build slot busy",
    "sources:",
    "  - kind: file",
    `    upload_id: ${uploadId}`,
    "    format: csv",
    "    alias: rows",
    "exports:",
    "  - kind: jsonl",
    "    output_path: data.jsonl",
  ].join("\n");
  const submitted = await request.post(`${BUILDER_URL}/builds`, { headers: bobAuth, data: { spec: bobsSpec } });
  expect(submitted.status(), await submitted.text()).toBe(202);
  const bobsRun = ((await submitted.json()) as Job).run_id;
  // Frees the slot however this test ends: Bob's build is not the business of the tests after it.
  cleanups.push(async () => {
    await request.post(`${BUILDER_URL}/builds/${encodeURIComponent(bobsRun)}/cancel`, { headers: bobAuth });
  });
  const bobsJob = async (): Promise<Job> =>
    (await (await request.get(`${BUILDER_URL}/builds/${encodeURIComponent(bobsRun)}`, { headers: bobAuth })).json()) as Job;
  await expect.poll(async () => (await bobsJob()).status, { timeout: 30_000 }).toBe("running");

  // 4) Alice builds. Her job waits behind Bob's, holding her key for as long as this
  //    Builder keeps a waiting job's keys.
  const accepted = alicePage.waitForResponse(
    (answer) => answer.url() === `${BUILDER_URL}/builds` && answer.request().method() === "POST",
  );
  await build.click();
  const alicesJob = (await (await accepted).json()) as Job;
  aliceRunId = alicesJob.run_id;
  expect(alicesJob.status, "Alice's job waits for the slot").toBe("queued");

  //    She closes the tab while it waits — what the review of #848 asked about: Studio
  //    stops watching the run there, so the spec has to be kept from submission, not
  //    from when Studio sees the run end.
  await alicePage.close();

  //    Her keys outlive their time while Bob's build still holds the slot. If Bob's build
  //    had ended first her job would have run with its keys, and this test would be
  //    checking nothing: say so rather than fail later for a reason nobody sees.
  await new Promise((done) => setTimeout(done, JOB_KEY_TTL_MS + 1_000));
  expect((await bobsJob()).status, "Bob's build still holds the slot after Alice's keys expired").toBe("running");

  // 5) Once the slot frees, her job ends as Builder ends a job whose keys are gone, and it
  //    never started: Builder has no spec of it.
  const alicesJobNow = async (): Promise<Job> =>
    (await (
      await request.get(`${BUILDER_URL}/builds/${encodeURIComponent(aliceRunId)}`, { headers: aliceAuth })
    ).json()) as Job;
  await expect.poll(async () => (await alicesJobNow()).status, { timeout: 180_000 }).toBe("failed");
  expect((await alicesJobNow()).code).toBe("credentials_required");
  //    Word for word the job Studio's readers are tested on, but for what names this run.
  const { run_id: _runId, created_at: _createdAt, updated_at: _updatedAt, created_by: _createdBy, ...recordedJob } =
    RECORDED.keysLostJob;
  expect(await alicesJobNow()).toEqual({
    ...recordedJob,
    run_id: aliceRunId,
    created_at: expect.any(String),
    updated_at: expect.any(String),
    created_by: expect.any(String),
  });
  const builderSpec = await request.get(`${BUILDER_URL}/builds/${encodeURIComponent(aliceRunId)}/spec`, {
    headers: aliceAuth,
  });
  expect(builderSpec.status(), "Builder keeps no spec of a run that never started").toBe(404);

  // 6) She opens the run again in a new tab — by its address: Refresh History lists only
  //    runs that started — and the lost-keys card offers the retry on the edit page…
  const runPath = `/refresh-jobs/${encodeURIComponent(aliceRunId)}`;
  //    This tab asks Builder twice without her key, further down, and is refused twice.
  const refusedForWantOfAKey = () => [`${BUILDER_URL}/preview`, `${BUILDER_URL}/builds`];
  const runPage = await openInNewTab(alice, ALICE, runPath, errors, expected404s, refusedForWantOfAKey);
  const card = runPage.locator(`[data-keys-lost="${aliceRunId}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(t("provider.missingKey.lostNoSpec"))).toHaveCount(0);
  const retry = card.locator('[data-keys-lost-next="edit"]');
  await expect(retry).toHaveText(t("provider.missingKey.retry"));

  // …and that page opens the spec she submitted, kept by this browser from submission.
  await retry.click();
  await expect(runPage).toHaveURL(new RegExp(`/refresh-jobs/${encodeURIComponent(aliceRunId)}/edit$`));
  await expect(runPage.getByText(t("newBuild.page.specEditing").replace("{{id}}", aliceRunId))).toBeVisible({
    timeout: 30_000,
  });
  await expect(runPage.getByText(t("newBuild.page.specNotFound").replace("{{id}}", aliceRunId))).toHaveCount(0);
  await expect(runPage.locator("#datasetId")).toHaveValue(DATASET_ID);

  // 7) This tab is a new one: the key she typed lived in the memory of the tab she closed.
  //    The preview is sent without it, Builder refuses and names the provider, and Studio
  //    asks for that provider's key where she is instead of showing an error sentence (#787).
  const next = runPage.getByRole("button", { name: t("newBuild.nav.next") });
  for (let step = 0; step < 3; step += 1) await next.click();
  const refusedPreview = runPage.waitForResponse(
    (answer) => answer.url() === `${BUILDER_URL}/preview` && answer.request().method() === "POST",
  );
  await runPage.getByRole("button", { name: t("newBuild.preview.refresh") }).click();
  const previewAnswer = await refusedPreview;
  expect(previewAnswer.request().headers()["x-provider-key"], "no key in this tab yet").toBeUndefined();
  expect(previewAnswer.status()).toBe(400);
  expect(await previewAnswer.json()).toEqual(recordedRefusal("preview", 400));
  const previewNotice = runPage.locator('[data-missing-provider-keys="datago"]');
  await expect(previewNotice).toBeVisible();
  await expect(previewNotice.locator('[data-key-needed="datago"]')).toBeVisible();

  // 8) She goes on to the review step without giving it. The build is refused the same
  //    way, before any run exists, and the notice there takes the key.
  //    Nothing is added to what she submitted: the output path Add Data left out stays
  //    out (#883).
  await next.click();
  await expect(runPage.locator("#outputPath")).toHaveValue("");
  await next.click();
  await runPage.getByRole("button", { name: t("newBuild.review.revalidate") }).click();
  await expect(runPage.getByText(t("newBuild.review.passed"))).toBeVisible({ timeout: 30_000 });
  const run = runPage.getByRole("button", { name: t("newBuild.review.runRefresh") });
  const refusedBuild = runPage.waitForResponse(
    (answer) => answer.url() === `${BUILDER_URL}/builds` && answer.request().method() === "POST",
  );
  await run.click();
  const buildAnswer = await refusedBuild;
  expect(buildAnswer.status()).toBe(400);
  expect(await buildAnswer.json()).toEqual(recordedRefusal("submitBuild", 400));
  const buildNotice = runPage.locator('[data-missing-provider-keys="datago"]');
  await expect(buildNotice).toBeVisible();
  await buildNotice.locator("#missing-provider-key-datago").fill(SESSION_KEY);
  await buildNotice.getByRole("button", { name: t("provider.missingKey.use") }).click();
  await expect(buildNotice.locator('[data-key-held="datago"]')).toBeVisible();
  //    The form she was on is as it was: the same table, the same step.
  await expect(run).toBeEnabled();

  // 9) The same definition is sent again, now with her key, as a new run that names the
  //    one that lost its keys — and it succeeds.
  const acceptedRetry = runPage.waitForResponse(
    (answer) => answer.url() === `${BUILDER_URL}/builds` && answer.request().method() === "POST",
  );
  await run.click();
  const retryAnswer = await acceptedRetry;
  expect(retryAnswer.status(), await retryAnswer.text()).toBe(202);
  expect(retryAnswer.request().headers()["x-provider-key"]).toBe(`datago=${SESSION_KEY}`);
  const sent = retryAnswer.request().postDataJSON() as { spec: string; retry_of?: string; run_id?: string };
  expect(sent.retry_of, "the new run names the one that lost its keys").toBe(aliceRunId);
  expect(JSON.parse(sent.spec)).toMatchObject({
    dataset_id: DATASET_ID,
    sources: [{ provider: "datago", dataset: "air_station", params: { station: "강남구", term: "daily" } }],
  });
  //    The key travels in the header, never in the definition.
  expect(sent.spec).not.toContain(SESSION_KEY);
  const retryRunId = ((await retryAnswer.json()) as Job).run_id;
  expect(retryRunId).not.toBe(aliceRunId);
  const retryJob = async (): Promise<Job> =>
    (await (
      await request.get(`${BUILDER_URL}/builds/${encodeURIComponent(retryRunId)}`, { headers: aliceAuth })
    ).json()) as Job;
  await expect.poll(async () => (await retryJob()).status, { timeout: 120_000 }).toBe("succeeded");
  await expect(runPage.getByText(t("newBuild.review.success").replace("{{id}}", retryRunId))).toBeVisible({
    timeout: 60_000,
  });
  //    The run that lost its keys is still what it was: failed, and hers.
  expect((await alicesJobNow()).status).toBe("failed");

  //    The key is in this tab's memory only: not in the address, and in nothing the
  //    browser keeps — IndexedDB included.
  expect(runPage.url()).not.toContain(SESSION_KEY);
  const kept = await runPage.evaluate(async () => {
    const stores: unknown[] = [{ ...localStorage }, { ...sessionStorage }, document.cookie];
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(name);
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const reading = db.transaction(store, "readonly").objectStore(store).getAll();
          reading.onsuccess = () => resolve(reading.result);
          reading.onerror = () => reject(reading.error);
        });
        stores.push({ name, store, rows });
      }
      db.close();
    }
    return JSON.stringify(stores);
  });
  expect(kept).not.toContain(SESSION_KEY);

  await expectNoPageErrors(errors);
});
