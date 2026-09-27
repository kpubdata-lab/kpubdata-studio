/**
 * minimal accessible disclosure (collapse/expand) pattern (#255 §3).
 *
 * secondary evidence (Run Events, BuildSpec snapshot처럼 핵심 판정을 대체하지 않는 부가 정보)를
 * 기본 collapsed로 두되, 키보드/스크린리더로도 펼칠 수 있게 실제 `<button>` + `aria-expanded`만
 * 쓴다. 새 accordion 라이브러리를 추가하지 않는다.
 */
import { useId, useState, type ReactNode } from "react";

export interface DisclosureProps {
  /** title always visible when collapsed (only definite values like count, no guessing). */
  title: ReactNode;
  /** whether initially expanded. Default false (collapsed) — don't use for primary info always expanded는다. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/** simple disclosure with only button + aria-expanded. Renders children only when expanded. */
export function Disclosure({ title, defaultOpen = false, children, className }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-sm font-semibold"
      >
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          {open ? "▼" : "▶"}
        </span>
        {title}
      </button>
      {open ? (
        <div id={contentId} className="mt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
