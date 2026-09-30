import type { StageStatus } from "@/shared/lib/builderApi";

const STATUS_CLASS: Record<StageStatus, string> = {
  completed: "bg-status-success-subtle text-status-success",
  failed: "bg-status-failure-subtle text-status-failure",
  not_run: "bg-muted text-muted-foreground",
  unavailable: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function StageBadge({ status }: { status: StageStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {status}
    </span>
  );
}
