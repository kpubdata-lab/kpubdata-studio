import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Connections as one table (#538), in a real browser: at 390px the page does not scroll
 * sideways — the table scrolls inside its own region — and a provider's credential panel
 * opens from the keyboard. Mock mode, deterministic provider list.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("연결 표는 390px 에서 표 안에서만 가로로 스크롤되고 키보드로 자격 증명 패널을 연다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/connections");
  const region = page.getByRole("region", { name: t("provider.table.caption") });
  await expect(region.getByRole("table")).toBeVisible({ timeout: 10_000 });
  await expect(region.getByRole("row", { name: /datago/ })).toContainText(t("provider.table.authKey"));

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "/connections horizontal overflow at 390px").toBeLessThanOrEqual(2);
  const regionScrolls = await region.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(regionScrolls, "the table scrolls inside its region").toBe(true);

  await region.focus();
  await expect(region).toBeFocused();
  const manage = region.getByRole("button", { name: `${t("provider.table.manage")} — kosis` });
  await manage.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /kosis/ })).toBeVisible();
  await expect(manage).toHaveAttribute("aria-pressed", "true");

  // The Test action (kpubdata-builder#842) runs from the keyboard and fills that row's last test.
  const datagoRow = region.getByRole("row", { name: /datago/ });
  await expect(datagoRow).toContainText(t("provider.table.neverTested"));
  await region.getByRole("button", { name: `${t("provider.table.test")} — datago` }).focus();
  await page.keyboard.press("Enter");
  await expect(datagoRow.locator('[data-last-test="not_configured"]')).toContainText(
    t("provider.status.probe.notConfigured"),
  );

  await expectNoPageErrors(errors);
});

test("Deleting a stored key asks first; dismissing keeps it and accepting says it was deleted (#988)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/connections?provider=kosis");
  await expect(page.getByRole("heading", { name: /kosis/ })).toBeVisible({ timeout: 10_000 });
  const remove = page.getByRole("button", { name: t("provider.detail.delete"), exact: true });
  await expect(remove).toBeVisible();
  const confirmText = t("provider.detail.deleteConfirm").replace("{{provider}}", "kosis");

  const dismissed = page.waitForEvent("dialog");
  void remove.click();
  const first = await dismissed;
  expect(first.type()).toBe("confirm");
  expect(first.message()).toBe(confirmText);
  await first.dismiss();
  await expect(remove).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: t("provider.detail.deleted").replace("{{provider}}", "kosis") })).toHaveCount(0);

  page.once("dialog", (dialog) => void dialog.accept());
  await remove.click();
  await expect(page.getByRole("status").filter({ hasText: t("provider.detail.deleted").replace("{{provider}}", "kosis") })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await expectNoPageErrors(errors);
});
