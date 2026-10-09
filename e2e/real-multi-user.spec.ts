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
function collectSignedInPageErrors(page: Page, bucket: string[], expected404s: () => string[] = () => []): void {
  page.on("pageerror", (error) => bucket.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const from = message.location().url;
    if (from === `${BUILDER_URL}/admin/config` && message.text().includes("403")) return;
    if (expected404s().includes(from.split("?")[0]) && message.text().includes("404")) return;
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
  await expect(page.getByRole("heading", { name: "Preview · 검증" })).toBeVisible();
  await page.getByRole("button", { name: "Preview 새로고침" }).first().click();
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
  await alicePage.getByRole("button", { name: "Preview 새로고침" }).first().click();
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
): Promise<Page> {
  const page = await context.newPage();
  collectSignedInPageErrors(page, errors, expected404s);
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

/**
 * A CSV big enough that building it takes Builder several seconds — far longer than this
 * Builder keeps a waiting job's keys. About 17 MB, under Builder's 20 MiB upload limit.
 */
function slowCsv(): Buffer {
  const lines = ["id,name,value,note"];
  for (let i = 0; i < 300_000; i += 1) lines.push(`${i},name-${i},${i * 1.5},some note text for row ${i}`);
  return Buffer.from(lines.join("\n"), "utf8");
}

test("대기 중 키가 만료된 실행의 재시도 링크는 스펙이 열리는 편집 화면으로 간다 (#846) @multi-user", async ({
  browser,
  request,
}) => {
  test.skip(!process.env.REAL_BUILDER_REPLAY, "Builder replay 모드 필요");
  // Bob's build has to run to its end before Alice's job reaches a worker.
  test.setTimeout(240_000);

  // 1) Bob, in a browser of his own, is the other user whose build takes the only slot.
  const bob = await browser.newContext();
  const bobPage = await bob.newPage();
  const bobsToken = nextBuilderToken(bobPage);
  await signIn(bobPage, BOB);
  const bobAuth = { Authorization: await bobsToken };

  // 2) Alice has her key for this session and a public-API table ready to build.
  const alice = await browser.newContext();
  const alicePage = await alice.newPage();
  const errors: string[] = [];
  let aliceRunId = "";
  // A run that never started has nothing on Builder but its job: its detail and edit pages
  // ask for its stages, quality, events, spec and manifest, and the edit page for the spec
  // revisions of a table that was never made. The browser logs each of those 404s.
  const expected404s = () =>
    aliceRunId === ""
      ? []
      : [
          ...["stages", "quality", "events", "spec", "manifest"].map(
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
  await alicePage.getByRole("button", { name: "Preview 새로고침" }).first().click();
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
  const builderSpec = await request.get(`${BUILDER_URL}/builds/${encodeURIComponent(aliceRunId)}/spec`, {
    headers: aliceAuth,
  });
  expect(builderSpec.status(), "Builder keeps no spec of a run that never started").toBe(404);

  // 6) She opens the run again in a new tab — by its address: Refresh History lists only
  //    runs that started — and the lost-keys card offers the retry on the edit page…
  const runPath = `/refresh-jobs/${encodeURIComponent(aliceRunId)}`;
  const runPage = await openInNewTab(alice, ALICE, runPath, errors, expected404s);
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

  await expectNoPageErrors(errors);

  // Bob's build is not this test's business any more.
  await request.post(`${BUILDER_URL}/builds/${encodeURIComponent(bobsRun)}/cancel`, { headers: bobAuth });
  await alice.close();
  await bob.close();
});
