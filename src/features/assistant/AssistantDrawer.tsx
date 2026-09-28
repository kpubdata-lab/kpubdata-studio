/**
 * Global Assistant drawer (#247, #256).
 *
 * Mounted once in `Layout` so the same Assistant UI can open from any page (avoid per-page duplicate
 * renders). Actual LLM integration, evidence/Generated SQL, and Suggested Actions are handled by
 * `AssistantContent` (shared via `useAssistantSession`); this component only manages opening/closing the
 * drawer and focus trapping.
 */
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { AssistantContent } from "./AssistantContent";

/**
 * A globally-openable Assistant drawer.
 *
 * @returns `null` if closed, otherwise the Assistant conversation panel reflecting the current
 *          screen context.
 */
export function AssistantDrawer() {
  const { t } = useTranslation();
  const isOpen = useUIStore((state) => state.isAssistantDrawerOpen);
  const closeAssistantDrawer = useUIStore((state) => state.closeAssistantDrawer);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  // When opened, move focus to the close button and cycle focus within the drawer.
  // When closed, restore focus to the element that opened the drawer (accessibility).
  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAssistantDrawer();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [isOpen, closeAssistantDrawer]);

  if (!isOpen) return null;

  return (
    <>
      {/* Click-only overlay — excluded from tab order/accessibility tree (ESC and the close
           button handle interaction inside). It is aria-hidden, so do not add a label. */}
      <button
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-zinc-950/45"
        data-testid="assistant-drawer-overlay"
        onClick={closeAssistantDrawer}
        tabIndex={-1}
        type="button"
      />
      <aside
        ref={dialogRef}
        aria-label={t("assistant.drawer.label")}
        aria-modal="true"
        role="dialog"
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden border-l border-border bg-card shadow-xl transition-[width] sm:w-[min(34rem,100vw)] ${expanded ? "lg:w-[min(60vw,60rem)]" : ""}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            ✨ {t("assistant.drawer.label")}
          </p>
          <div className="flex gap-1.5">
            <button aria-label={expanded ? t("assistant.drawer.collapseLabel") : t("assistant.drawer.expandLabel")} aria-pressed={expanded} className="hidden rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted lg:block" onClick={() => setExpanded((value) => !value)} type="button">
              {expanded ? t("assistant.drawer.collapse") : t("assistant.drawer.expand")}
            </button>
            <button ref={closeButtonRef} aria-label={t("assistant.drawer.close")} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={closeAssistantDrawer} type="button">✕</button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <AssistantContent compact />
        </div>
      </aside>
    </>
  );
}
