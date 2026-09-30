/**
 * Preview page (/preview, legacy deep-link).
 *
 * Preview is now integrated into New Build Wizard's 'preview' step (proposal §5.3).
 * This screen is maintained for deep-link compatibility and guides to wizard.
 */
import { useTranslation } from "react-i18next";
import { Card, EmptyState, PageHeader } from "@/shared/ui";

/**
 * Legacy page guiding preview flow to wizard.
 *
 * @returns Preview guidance screen.
 */
export function PreviewPage() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        title={t("previewPage.title")}
        description={t("previewPage.desc")}
      />

      <Card className="p-0">
        <EmptyState
          title={t("previewPage.emptyTitle")}
          description={t("previewPage.emptyDesc")}
          actionLabel={t("previewPage.cta")}
          actionHref="/refresh-jobs/new"
        />
      </Card>
    </main>
  );
}
