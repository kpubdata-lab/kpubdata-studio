import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Command palette keyboard behaviour in a real browser: Tab stays inside the dialog and
 * Esc closes it wherever focus is (#654); Ctrl+K closes it the way every other close
 * does (#656).
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });
}

const focusInsideDialog = (page: Page) =>
  page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));

test("Tab과 Shift+Tab이 팔레트 밖으로 나가지 않고, 입력란 밖에서도 Esc로 닫힌다 (#654)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await openHome(page);

  const trigger = page.getByRole("button", { name: t("layout.search.open") });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: t("layout.search.dialog") });
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  await page.keyboard.type("대기");

  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await focusInsideDialog(page), `focus after ${key}`).toBe(true);
  }

  // A click on a group heading leaves focus on the dialog, not in the input.
  await dialog.getByText(t("layout.search.groups.filters"), { exact: true }).click();
  await expect(input).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await expectNoPageErrors(errors);
});

test("Ctrl+K로 닫으면 검색어가 지워지고 포커스가 검색 버튼으로 돌아온다 (#656)", async ({ page }) => {
  await openHome(page);
  const trigger = page.getByRole("button", { name: t("layout.search.open") });
  const dialog = page.getByRole("dialog", { name: t("layout.search.dialog") });

  await page.keyboard.press("Control+k");
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("대기");
  await page.keyboard.press("ArrowDown");

  await page.keyboard.press("Control+k");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Control+k");
  await expect(dialog.getByRole("combobox")).toHaveValue("");
  await expect(dialog.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
});
