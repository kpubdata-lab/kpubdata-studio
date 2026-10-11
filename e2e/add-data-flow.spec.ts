import { expect, test } from "@playwright/test";
import { collectPageErrors, expectNoPageErrors, prepareCleanPage, t } from "./helpers";

/**
 * Create Table scenario (#268 scenarios 1/2/3, mock deterministic).
 *
 * Public API happy path: Source selection → Configure → (Preview) → Review with
 * canonical BuildSpec confirmation. File source entry also verified.
 * Actual submission·execution is cross-repo (kpubdata#282) scope.
 */
test.beforeEach(async ({ page }) => {
  await prepareCleanPage(page);
});

test("Public API source로 Source→Configure 단계가 진행된다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/add");
  await expect(page.getByRole("heading", { name: t("addData.source.title") })).toBeVisible();

  // Step 1 has 3 source kind cards — select Public API.
  const publicApiCard = page.getByRole("button", { name: /공공 API/ }).first();
  await expect(publicApiCard).toBeVisible();
  await publicApiCard.click();

  // Next step (Configure): provider/dataset selection form renders.
  await page.getByRole("button", { name: "다음" }).first().click();
  // Same text appears in stepper label too; getByText catches two — narrow to step heading.
  await expect(page.getByRole("heading", { name: t("addData.configure.title") })).toBeVisible();
  await expect(page.getByLabel(t("addData.configure.providerLabel"))).toBeVisible();
  await expect(page.getByLabel(t("addData.configure.datasetLabel"))).toBeVisible();

  await expectNoPageErrors(errors);
});

test("File source 탭이 표시되고 업로드 UI가 존재한다", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto("/add");
  await expect(page.getByRole("heading", { name: t("addData.source.title") })).toBeVisible();

  // File entry point exists in Source kind selection.
  const fileEntry = page.getByRole("button", { name: "파일 업로드" }).first();
  await expect(fileEntry).toBeVisible();

  await expectNoPageErrors(errors);
});

test("Review 단계는 진입 전 단계를 거쳐야 한다(임의 진입 방어는 유닛 레벨 검증)", async ({
  page,
}) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // Entering /add without wizard state always starts at step 1 (except draft restore prompt).
  await page.goto("/add");
  await expect(page.getByRole("heading", { name: t("addData.source.title") })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: t("addData.source.title") }).or(page.getByText(/복원/).first()).first()).toBeVisible();

  await expectNoPageErrors(errors);
});

test("키보드만으로 단계를 오갈 때 포커스가 새 단계 제목으로 옮겨간다 (#669)", async ({ page }) => {
  const errors: string[] = [];
  collectPageErrors(page, errors);

  // Catalog's start action preselects the source, so Configure is ready for Next.
  await page.goto("/add?provider=datago&dataset=apt_trade");
  const sourceHeading = page.getByRole("heading", { name: t("addData.source.title") });
  await expect(sourceHeading).toBeVisible();
  await expect(page.getByText(/ID: datago-apt-trade/)).toBeVisible();
  // First load leaves focus where the browser put it.
  await expect(sourceHeading).not.toBeFocused();

  const next = page.getByRole("button", { name: t("addData.nav.next"), exact: true });
  await next.focus();
  await page.keyboard.press("Enter");
  const previewHeading = page.getByRole("heading", { name: t("addData.preview.title") });
  await expect(previewHeading).toBeFocused();

  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: t("addData.review.title") })).toBeFocused();

  await page.getByRole("button", { name: t("addData.nav.back"), exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(previewHeading).toBeFocused();

  // Going back through the Stepper moves focus the same way.
  const stepper = page.getByRole("list", { name: t("addData.stepper.label") });
  await stepper.getByRole("button", { name: new RegExp(t("addData.stepper.configure")) }).focus();
  await page.keyboard.press("Enter");
  await expect(sourceHeading).toBeFocused();

  await expectNoPageErrors(errors);
});
