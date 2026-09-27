/**
 * public DEMO/DEV environment badge.
 *
 * recurring guidance text indicating mock/demo environment without real account auth 대신
 * 눈에 띄는 배지 하나로 표시한다. `isRealBuilderEnabled()`(실제 Builder 연동 여부)로
 * 판단하는 호출부에서만 조건부로 렌더링한다 — 이 컴포넌트 자체는 항상 "DEMO"를 뜻한다.
 */
import { cn } from "./cn";

export interface DemoBadgeProps {
  className?: string;
}

export function DemoBadge({ className }: DemoBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      DEMO
    </span>
  );
}
