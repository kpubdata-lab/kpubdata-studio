/**
 * common Skeleton component (proposal §11).
 *
 * fill content placeholder with pulse animation while data loading)이션 블록으로 채운다. 보조기기에는
 * aria-hidden으로 숨긴다(상태 guidance는 로딩 텍스트가 담당).
 */
import { cn } from "./cn";

export interface SkeletonProps {
  /** additional className (size/shape specification) */
  className?: string;
}

/**
 * render single pulse block.
 *
 * @param props - className.
 * @returns skeleton block.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
    />
  );
}

export interface SkeletonTableProps {
  /** number of rows */
  rows?: number;
  /** additional className */
  className?: string;
}

/**
 * render batch of skeleton rows for table loading.
 *
 * @param props - rows/className.
 * @returns 스켈레톤 행 목록.
 */
export function SkeletonTable({ rows = 3, className }: SkeletonTableProps) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-3 p-6", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-6 w-full" />
      ))}
    </div>
  );
}
