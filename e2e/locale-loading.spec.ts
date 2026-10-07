import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { collectPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Each locale is its own chunk, fetched when its language is needed (#796).
 *
 * Runs in the `csp-chromium` project, against `vite preview` of a production build: only
 * there do the locales exist as the chunks a visitor downloads (`assets/ko-*.js`,
 * `assets/en-*.js`). The dev server serves the JSON files as modules instead.
 */

const en = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/shared/i18n/locales/en.json", import.meta.url)), "utf8"),
) as { nav: { home: string } };

const KOREAN_CHUNK = /\/assets\/ko-[\w-]+\.js$/;
const ENGLISH_CHUNK = /\/assets\/en-[\w-]+\.js$/;

function requests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

async function storeLanguage(page: Page, language: string): Promise<void> {
  // After prepareCleanPage's script, which clears storage on every load.
  await page.addInitScript((value) => localStorage.setItem("studio-lang", value), language);
}

const homeLink = (page: Page, name: string) => page.getByRole("link", { name, exact: true }).first();

test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("a Korean visit fetches the Korean locale only", async ({ page }) => {
  const urls = requests(page);

  await page.goto("/");

  await expect(homeLink(page, t("nav.home"))).toBeVisible();
  expect(urls.filter((url) => KOREAN_CHUNK.test(url))).toHaveLength(1);
  expect(urls.filter((url) => ENGLISH_CHUNK.test(url))).toEqual([]);
});

test("an English visit is English on the first paint and fetches the English locale only", async ({ page }) => {
  await storeLanguage(page, "en");
  const urls = requests(page);
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/");

  await expect(homeLink(page, en.nav.home)).toBeVisible();
  await expect(page.getByText("nav.home")).toHaveCount(0);
  expect(urls.filter((url) => ENGLISH_CHUNK.test(url))).toHaveLength(1);
  expect(urls.filter((url) => KOREAN_CHUNK.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});

test("an English visit whose locale cannot be fetched is Korean, and keeps the choice", async ({ page }) => {
  await storeLanguage(page, "en");
  await page.route(ENGLISH_CHUNK, (route) => route.abort("internetdisconnected"));

  await page.goto("/");

  await expect(homeLink(page, t("nav.home"))).toBeVisible();
  await expect(page.getByText("nav.home")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("studio-lang"))).toBe("en");
});

test("switching to a language that cannot be fetched says so and keeps the current one", async ({ page }) => {
  await page.route(ENGLISH_CHUNK, (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await expect(homeLink(page, t("nav.home"))).toBeVisible();

  await page.getByRole("button", { name: t("layout.account.open") }).click();
  await page.getByLabel(t("layout.account.language")).selectOption("en");

  await expect(page.getByRole("alert")).toHaveText(t("layout.account.languageLoadFailed"));
  await expect(page.getByLabel(t("layout.account.language"))).toHaveValue("ko");
  await expect(homeLink(page, t("nav.home"))).toBeVisible();
  await expect(page.getByText("nav.home")).toHaveCount(0);
});
