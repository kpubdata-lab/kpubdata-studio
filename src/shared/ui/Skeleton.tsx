/**
 * Common Skeleton component (proposal §11).
 *
 * Fills content placeholder with pulse animation blocks while data loads. Hidden from
 * assistive tech via aria-hidden (status guidance handled by loading text).
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
 * Render batch of skeleton rows for table loading.
 *
 * @param props - rows/className.
 * @returns Skeleton row list.
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
