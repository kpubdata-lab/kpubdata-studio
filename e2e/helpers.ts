import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

/**
 * Common helpers (#268).
 *
 * - collectPageErrors: each spec can assert no console error/unhandled rejection
 *   (issue checklist).
 * - localStorage cleanup: initialize on context start so user state (Workspace #293 owner bucket)
 *   doesn't leak across specs.
 * - t(): fetch screen text from locale file, not hardcoded in spec.
 */

/**
 * ko locale dictionary.
 *
 * `import ko from "....json"` requires Node import attribute (`with { type: "json" }`)
 * in Playwright's ESM loader, causing **spec collection itself to fail**.
 * Reading at runtime avoids loader syntax difference.
 */
const ko = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/shared/i18n/locales/ko.json", import.meta.url)), "utf8"),
) as Record<string, unknown>;

export function t(path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], ko);
  if (typeof value !== "string") {
    throw new Error(`ko 로케일에 문자열 키가 없다: ${path}`);
  }
  return value;
}

export async function prepareCleanPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      // Ignore in private mode etc.
    }
  });
}

export function collectPageErrors(page: Page, bucket: string[]): void {
  page.on("pageerror", (error) => bucket.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // In Builder-not-running env, mock-first screens (Workspace etc) try Builder query first
    // then fallback is app design normal (#292) — resource load failure reports aren't app errors, exclude.
    if (text.includes("net::ERR_CONNECTION_REFUSED")) return;
    bucket.push(`console.error: ${text}`);
  });
}

export async function expectNoPageErrors(bucket: string[]): Promise<void> {
  // In mock mode, mock data fallback logs (warn) allowed — only catch errors.
  expect(bucket, `page errors:\n${bucket.join("\n")}`).toEqual([]);
}
