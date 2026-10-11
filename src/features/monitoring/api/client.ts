/**
 * The monitoring client: one interface, a Builder and a demo behind it (#794, #902).
 *
 * The screen asks `monitoringClient()` and does not know which answers. Builder's answer
 * is its summary and its last 24 hours of refreshes, read together; a refusal (401/403)
 * or a failure is passed on as it came, never replaced with demo data (#302). The demo's
 * is its fixture, which always answers.
 */
import { builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { MonitoringData } from "../model";
import { getMockMonitoringData } from "./mockData";

export interface MonitoringClient {
  /** `GET /monitoring/summary` and `GET /monitoring/builds`, together. */
  load(): Promise<MonitoringData>;
}

export const realMonitoringClient: MonitoringClient = {
  async load() {
    const [summary, builds] = await Promise.all([builderApi.getMonitoringSummary(), builderApi.getMonitoringBuilds()]);
    return { summary, builds };
  },
};

export const demoMonitoringClient: MonitoringClient = { load: async () => getMockMonitoringData() };

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function monitoringClient(): MonitoringClient {
  return isRealBuilderEnabled() ? realMonitoringClient : demoMonitoringClient;
}
