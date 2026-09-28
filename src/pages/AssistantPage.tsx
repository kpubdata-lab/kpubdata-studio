/**
 * Assistant dedicated screen (`/kubi`, #256).
 *
 * Shares the same `useAssistantSession` conversation with the global drawer (`src/features/assistant/AssistantDrawer.tsx`) —
 * not a separate Assistant system, but the same state displayed in a wider layout.
 */
import { useTranslation } from "react-i18next";
import { AssistantContent } from "@/features/assistant/AssistantContent";
import { PageHeader } from "@/shared/ui";

export function AssistantPage() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        eyebrow={t("assistant.page.eyebrow")}
        title={t("assistant.page.title")}
        description={t("assistant.page.desc")}
      />
      <AssistantContent />
    </main>
  );
}
