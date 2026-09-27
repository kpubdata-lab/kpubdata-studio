/**
 * common placeholder for routes not yet wired to actual screens (#247).
 *
 * Epic #246's new IA is backward compat슈 단위로 순차 구현된다. App Shell/Navigation(#247) 단계에서
 * route와 metadata)뉴가 먼저 존재해야 이후 화면 이슈들이 동일한 layout에서 이어받을 수 있으므로,
 * 아직 구현되지 않은 화면은 관련 없는 기존 화면을 재사용하는 대신 명시적인 placeholder를 보여준다.
 */
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Card } from "./Card";
import { PageHeader } from "./PageHeader";

export interface PlaceholderPageProps {
  /** PageHeader top label */
  eyebrow: string;
  /** page title */
  title: string;
  /** explanation of what this screen ultimately does */
  description: string;
  /** text guiding which issue actually implements this */
  note: ReactNode;
}

/**
 * placeholder page showing "coming soon" guidance with title/description.
 *
 * @param props - eyebrow/title/description/note.
 * @returns placeholder 화면 엘리먼트.
 */
export function PlaceholderPage({ eyebrow, title, description, note }: PlaceholderPageProps) {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Card variant="dashed" className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-lg font-medium tracking-tight">{t("placeholder.notReady")}</p>
        <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">{note}</p>
      </Card>
    </main>
  );
}
