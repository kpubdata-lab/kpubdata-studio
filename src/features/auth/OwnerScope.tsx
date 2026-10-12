/**
 * The boundary that drops screen state when another account signs in (#902).
 *
 * Server state has no shared cache: each screen holds what it loaded (ARCHITECTURE.md,
 * the server-state policy). Keyed by the storage owner, everything inside is unmounted and mounted
 * again when the owner changes — so every effect's cleanup aborts what is still in flight,
 * and no screen has to remember to put the owner in its own dependencies.
 */
import { Fragment, type ReactNode } from "react";

import { useStorageOwnerKey } from "./storageOwner";

export function OwnerScope({ children }: { children: ReactNode }) {
  const owner = useStorageOwnerKey();
  return <Fragment key={owner}>{children}</Fragment>;
}
