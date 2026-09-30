/**
 * The warehouse endpoints for this deployment (#530).
 *
 * With a Builder connected they are `builderApi`'s own; in the demo they are the demo
 * warehouse (`features/datasets/api/mockWarehouse.ts`), so the demo shows tables and
 * snapshots the way a warehouse Builder does. `builderApi` itself keeps no mock branch
 * (#246); this is the one place the warehouse screens choose.
 */
import { mockWarehouseApi, type WarehouseApi } from "@/features/datasets/api/mockWarehouse";
import { builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";

export function warehouseApi(): WarehouseApi {
  return isRealBuilderEnabled() ? builderApi : mockWarehouseApi;
}
