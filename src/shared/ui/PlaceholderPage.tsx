/**
 * Common placeholder for routes not yet wired to actual screens (#247).
 *
 * Epic #246's new IA is backward-compat-per-phase sequentially implemented. In App
 * Shell/Navigation (#247) stage, routes and menu must exist first so subsequent screen
 * issues inherit same layout; unimplemented screens show explicit placeholder instead
 * of reusing unrelated existing screen.
 */
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Card } from "./Card";
import { PageHeader } from "./PageHeader";

export interface PlaceholderPageProps {
  /** page title */
  title: string;
  /** explanation of what this screen ultimately does */
  description: string;
  /** text guiding which issue actually implements this */
  note: ReactNode;
}

/**
 * Placeholder page showing "coming soon" guidance with title/description.
 *
 * @param props - title/description/note.
 * @returns Placeholder screen element.
 */
export function PlaceholderPage({ title, description, note }: PlaceholderPageProps) {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader title={title} description={description} />
      <Card variant="dashed" className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-lg font-medium tracking-tight">{t("placeholder.notReady")}</p>
        <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">{note}</p>
      </Card>
    </main>
  );
}
