/**
 * Artifacts landing page (/artifacts).
 *
 * Artifacts are managed per build (proposal §5.7), so this global screen guides users
 * to select a build. Detailed artifacts per build are viewed at /builds/:buildId/artifacts.
 */
import { useTranslation } from "react-i18next";
import { Card, EmptyState, PageHeader } from "@/shared/ui";

/**
 * Global artifacts landing page that guides users to the per-build artifacts screen.
 *
 * @returns Artifacts landing screen.
 */
export function ArtifactsPage() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        eyebrow={t("artifactsPage.eyebrow")}
        title={t("artifactsPage.title")}
        description={t("artifactsPage.desc")}
      />

      <Card className="p-0">
        <EmptyState
          title={t("artifactsPage.emptyTitle")}
          description={t("artifactsPage.emptyDesc")}
          actionLabel={t("artifactsPage.cta")}
          actionHref="/builds"
        />
      </Card>
    </main>
  );
}
