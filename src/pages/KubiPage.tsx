/**
 * Kubi dedicated screen (`/kubi`, #256).
 *
 * Shares the same `useKubiSession` conversation with the global drawer (`src/features/kubi/KubiDrawer.tsx`) —
 * not a separate Kubi system, but the same state displayed in a wider layout.
 */
import { useTranslation } from "react-i18next";
import { KubiContent } from "@/features/kubi/KubiContent";
import { PageHeader } from "@/shared/ui";

export function KubiPage() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        eyebrow="Kubi"
        title="Kubi · AI Data Copilot"
        description={t("kubi.page.desc")}
      />
      <KubiContent />
    </main>
  );
}
