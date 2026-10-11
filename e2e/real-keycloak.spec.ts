import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectNoPageErrors, t } from "./helpers";

/**
 * Studio, a real Keycloak and a Builder with its sign-up ledger (#903, tag `@keycloak`).
 *
 * `real-multi-user.spec.ts` signs in through a stand-in identity provider that signs in
 * whoever is asked for. Here `scripts/run-keycloak-e2e.mjs` has started Keycloak with
 * sign-up and Verify email on, a mail catcher the realm sends its mail to, and a Builder
 * with one administrator and no allowlist — so a new account is held back as `pending`
 * until that administrator approves it — and can restart that Builder on request.
 *
 * Not here, and why: suspending an account waits on Builder's decision about what
 * suspension is (kpubdata-builder#1124), and deleting one on the feature itself
 * (kpubdata-builder#1102).
 */
const BUILDER_URL = process.env.REAL_BUILDER_URL ?? "http://localhost:8905";
const ISSUER = process.env.KEYCLOAK_E2E_ISSUER ?? "";
const MAIL_URL = process.env.KEYCLOAK_E2E_MAIL_URL ?? "http://localhost:8025";
const CONTROL_URL = process.env.KEYCLOAK_E2E_CONTROL_URL ?? "http://127.0.0.1:8906";
const ADMIN_EMAIL = process.env.KEYCLOAK_E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.KEYCLOAK_E2E_ADMIN_PASSWORD ?? "";
const MEMBER_PASSWORD = process.env.KEYCLOAK_E2E_MEMBER_PASSWORD ?? "";

test.skip(!process.env.KEYCLOAK_E2E, "Keycloak and a Builder needed — scripts/run-keycloak-e2e.mjs starts them");

const keycloakOrigin = () => new URL(ISSUER).origin;
const mainMenu = (page: Page) => page.getByRole("navigation", { name: "주 메뉴" });

/** The next Authorization header Studio sends Builder. */
function nextBuilderToken(page: Page): Promise<string> {
  return page
    .waitForRequest((sent) => sent.url().startsWith(BUILDER_URL) && Boolean(sent.headers()["authorization"]))
    .then((sent) => sent.headers()["authorization"]!);
}

/** Wait until the identity provider has sent `page` back to Studio, past the login page. */
async function backInStudio(page: Page): Promise<void> {
  const studio = new URL(test.info().project.use.baseURL ?? "http://localhost:5176").origin;
  await page.waitForURL((url) => url.origin === studio && !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

/** The link in the verification mail Keycloak sent `address`, read from the mail catcher. */
async function verificationLink(request: APIRequestContext, address: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAIL_URL}/api/v1/search`, { params: { query: `to:"${address}"` } });
        id = ((await search.json()) as { messages: Array<{ ID: string }> }).messages[0]?.ID;
        return id;
      },
      { message: `a mail to ${address}`, timeout: 60_000 },
    )
    .toBeTruthy();
  const message = (await (await request.get(`${MAIL_URL}/api/v1/message/${id}`)).json()) as { Text: string };
  const link = message.Text.match(/https?:\/\/\S+\/login-actions\/action-token\?\S+/)?.[0];
  expect(link, "a verification link in the mail").toBeTruthy();
  return link!;
}

/** What Builder answers `GET /providers` with for this Authorization header. */
async function providersAnswer(request: APIRequestContext, authorization: string) {
  const answer = await request.get(`${BUILDER_URL}/providers`, { headers: { Authorization: authorization } });
  return { status: answer.status(), code: ((await answer.json()) as { code?: string }).code };
}

test("가입하고 이메일을 인증한 계정은 관리자 승인 뒤에 들어오고, Builder 가 다시 시작해도 로그인이 유지된다 (#903) @keycloak", async ({
  browser,
  request,
}) => {
  const email = `member-${Date.now()}@e2e.kpubdata.test`;
  const member = await browser.newContext();
  const page = await member.newPage();
  const errors: string[] = [];
  // Studio's uncaught exceptions only. While the account is pending every Builder request
  // is refused with 403 by design, and the browser logs each one as a console error; and
  // Keycloak's own pages are not Studio's to answer for.
  page.on("pageerror", (error) => {
    if (new URL(page.url()).origin !== keycloakOrigin()) errors.push(`pageerror: ${error.message} (${page.url()})`);
  });

  await test.step("sign up on Keycloak's own page, from Studio's sign-up screen", async () => {
    await page.goto("/signup");
    // keycloak-js asks the realm about an existing session in hidden frames first. A
    // sign-in started while that check is still talking to Keycloak can lose its login
    // session ("Your login attempt timed out"), so the check is let finish.
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: t("auth.signup.cta") }).click();
    await page.waitForURL((url) => url.origin === keycloakOrigin(), { timeout: 30_000 });
    await page.locator('a[href*="/login-actions/registration"]').click();
    await page.locator("#email").fill(email);
    await page.locator("#firstName").fill("Mina");
    await page.locator("#lastName").fill("Member");
    // Keycloak 26.7's registration form asks for no password; an older one does.
    if ((await page.locator("#password").count()) > 0) {
      await page.locator("#password").fill(MEMBER_PASSWORD);
      await page.locator("#password-confirm").fill(MEMBER_PASSWORD);
    }
    await page.locator('[type="submit"]').click();
    // Keycloak holds the new account until its address is verified: no token yet, so
    // Studio is not reached.
    await expect(page.getByText(/verify your email/i).first()).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).origin).toBe(keycloakOrigin());
  });

  let authorization = "";
  await test.step("verify the address from the mail, and wait for approval in Studio", async () => {
    const link = await verificationLink(request, email);
    const token = nextBuilderToken(page);
    await page.goto(link);
    // A password the registration form did not ask for is asked for now.
    const newPassword = page.locator("#password-new");
    const studioOrLogin = await Promise.race([
      newPassword.waitFor({ timeout: 30_000 }).then(() => "password" as const),
      backInStudio(page).then(() => "studio" as const),
    ]);
    if (studioOrLogin === "password") {
      await newPassword.fill(MEMBER_PASSWORD);
      await page.locator("#password-confirm").fill(MEMBER_PASSWORD);
      await page.locator('[type="submit"]').click();
    }
    await backInStudio(page);
    authorization = await token;
    // Builder's ledger holds the new account back, and Studio says so in place of the page.
    await expect(page.locator('[data-signup-block="pending"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: t("signupStatus.pending.title") })).toBeVisible();
    expect(await providersAnswer(request, authorization)).toEqual({ status: 403, code: "signup_pending" });
  });

  await test.step("the administrator approves the account on the administration screen", async () => {
    const admin = await browser.newContext();
    const adminPage = await admin.newPage();
    await adminPage.goto("/login");
    await adminPage.waitForLoadState("networkidle");
    await adminPage.getByRole("button", { name: t("auth.page.emailLogin") }).click();
    await adminPage.waitForURL((url) => url.origin === keycloakOrigin(), { timeout: 30_000 });
    await adminPage.locator("#username").fill(ADMIN_EMAIL);
    await adminPage.locator("#password").fill(ADMIN_PASSWORD);
    const adminToken = nextBuilderToken(adminPage);
    await adminPage.locator('[type="submit"]').click();
    await backInStudio(adminPage);
    await mainMenu(adminPage).getByRole("link", { name: /^(Administration|관리)$/ }).click();

    const approve = adminPage.getByRole("button", { name: t("admin.users.approveLabel").replace("{{name}}", email) });
    await expect(approve).toBeVisible({ timeout: 30_000 });
    adminPage.once("dialog", (dialog) => void dialog.accept());
    const decided = adminPage.waitForResponse(
      (answer) => answer.url().startsWith(`${BUILDER_URL}/admin/users/`) && answer.request().method() === "POST",
    );
    await approve.click();
    const answer = await decided;
    if (answer.status() === 404 && answer.url().includes("%3A")) {
      // kpubdata-builder#1277: Builder looks the id up without decoding the path, so the
      // `oidc:` id Studio sends percent-encoded is not found. Only that defect is let
      // through, and the same decision is made with the id as Builder lists it, so the
      // scenario goes on to what follows an approval.
      expect(((await answer.json()) as { code?: string }).code).toBe("user_not_found");
      test.info().annotations.push({ type: "known defect", description: "kpubdata-builder#1277" });
      const headers = { Authorization: await adminToken };
      const ledger = (await (await request.get(`${BUILDER_URL}/admin/users`, { headers })).json()) as {
        users: Array<{ user_id: string; display_name: string | null }>;
      };
      const userId = ledger.users.find((user) => user.display_name === email)?.user_id ?? "";
      expect(userId).toMatch(/^oidc:/);
      const approved = await request.post(`${BUILDER_URL}/admin/users/${userId}/approve`, { headers });
      expect(approved.status(), await approved.text()).toBe(200);
    } else {
      expect(answer.status()).toBe(200);
      await expect(approve).toHaveCount(0, { timeout: 30_000 });
    }
    await admin.close();
  });

  await test.step("the member checks again and is let in, without signing in again", async () => {
    await page.getByRole("button", { name: t("signupStatus.checkAgain") }).click();
    await expect(page.locator("[data-signup-block]")).toHaveCount(0, { timeout: 30_000 });
    await expect(mainMenu(page)).toBeVisible();
    expect((await providersAnswer(request, authorization)).status).toBe(200);
  });

  await test.step("Builder restarts in the middle of the session", async () => {
    const restarted = await request.post(`${CONTROL_URL}/builder/restart`, { timeout: 120_000 });
    expect(restarted.status(), "Builder came back").toBe(200);

    // The same token, which Builder verifies again from the realm's keys after its start,
    // and the same approval, which the ledger kept on disk.
    expect(await providersAnswer(request, authorization)).toEqual({ status: 200, code: undefined });

    // Studio's session lives in memory and survives: the next screen loads from the new
    // Builder without a trip to the login page or the approval notice.
    const history = page.waitForResponse(
      (answer) => answer.url().startsWith(`${BUILDER_URL}/builds`) && answer.request().method() === "GET",
    );
    await mainMenu(page).getByRole("link", { name: /^(Refresh History|갱신 이력)$/ }).first().click();
    expect((await history).status()).toBe(200);
    await expect(page.getByRole("heading", { name: /갱신 이력|Refresh History/i }).first()).toBeVisible();
    expect(new URL(page.url()).pathname.startsWith("/login")).toBe(false);
    await expect(page.locator("[data-signup-block]")).toHaveCount(0);
  });

  await expectNoPageErrors(errors);
  await member.close();
});
