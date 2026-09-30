/**
 * The demo has a warehouse (#530). A test about a deployment without one — the run-based
 * Table Detail, the run-based SQL Workspace, Home's recent runs — hides it, the way such a
 * Builder answers: `GET /warehouse/tables` fails.
 */
import { vi } from "vitest";

import { mockWarehouseApi } from "@/features/datasets/api/mockWarehouse";
import { ApiError } from "@/shared/lib/builderApi";

export function hideDemoWarehouse() {
  return vi
    .spyOn(mockWarehouseApi, "listWarehouseTables")
    .mockRejectedValue(new ApiError(404, "warehouse_not_configured", { code: "warehouse_not_configured" }));
}
