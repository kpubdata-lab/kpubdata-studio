/**
 * Mock-mode fixture (#264, #303) — same shape as the Builder's real wire
 * contract (/monitoring/summary + /monitoring/builds).
 */
import type { MonitoringData } from "@/features/monitoring/model";

export function getMockMonitoringData(): MonitoringData {
  const now = Date.now();
  const hourAgo = (hours: number) => new Date(now - hours * 3600000).toISOString();

  return {
    summary: {
      generated_at: new Date(now).toISOString(),
      status: "healthy",
      api: { availability: "available", sample_count: 128, p95_latency_ms: 245 },
      queue: { availability: "available", waiting: 3, running: 2, total: 5 },
      workers: { availability: "available", active: 2, capacity: 4, utilization: 0.5 },
      artifact_store: {
        availability: "available",
        last_write_at: new Date(now).toISOString(),
      },
    },
    builds: {
      window: "24h",
      bucket: "hour",
      availability: "available",
      excluded_count: 0,
      buckets: [0, 4, 8, 12, 16, 20].map((hour, index) => {
        const success = [12, 8, 15, 20, 18, 10][index];
        const failed = [1, 0, 2, 1, 0, 1][index];
        const cancelled = [0, 1, 0, 0, 0, 1][index];
        return {
          bucket_start: `2026-01-01T${String(hour).padStart(2, "0")}:00:00+00:00`,
          bucket_end: `2026-01-01T${String(hour + 1).padStart(2, "0")}:00:00+00:00`,
          total: success + failed + cancelled,
          success,
          failed,
          cancelled,
        };
      }),
      recent_runs: [
        {
          run_id: "run-001",
          status: "ok",
          started_at: hourAgo(1),
          finished_at: hourAgo(0.5),
        },
        {
          run_id: "run-002",
          status: "failed",
          started_at: hourAgo(2),
          finished_at: hourAgo(1.6),
        },
        {
          run_id: "run-003",
          status: "running",
          started_at: hourAgo(0.2),
          finished_at: null,
        },
        {
          run_id: "run-004",
          status: "cancelled",
          started_at: hourAgo(3),
          finished_at: hourAgo(2.7),
        },
      ],
    },
  };
}
