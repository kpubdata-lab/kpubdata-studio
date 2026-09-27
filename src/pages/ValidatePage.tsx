/**
 * Validation result page (/validate, legacy deeplink).
 *
 * Validation integrated into New Build wizard, but this page offers
 * assistant (ST-A5) to explain validation errors and suggest fixes.
 */
import { useTranslation } from "react-i18next";
import { Card, EmptyState, PageHeader } from "@/shared/ui";
import { AssistantChat } from "@/features/assistant/AssistantChat";

export function ValidatePage() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        eyebrow={t("validatePage.eyebrow")}
        title={t("validatePage.title")}
        description={t("validatePage.desc")}
      />

      <Card className="p-0">
        <EmptyState
          title={t("validatePage.emptyTitle")}
          description={t("validatePage.emptyDesc")}
          actionLabel={t("validatePage.cta")}
          actionHref="/builds/new"
        />
      </Card>

      <AssistantChat />
    </main>
  );
}
