/**
 * `/refresh-jobs/new` was a second table creation wizard (#534). There is one creation
 * flow now, at `/add`; the old URL redirects there with its query and hash, so a Workspace
 * link (`?savedSpecId=`) still opens its spec. `replace` keeps the old URL out of history.
 */
import { Navigate, useLocation } from "react-router-dom";

/** Where table creation lives. */
export const CREATE_TABLE_PATH = "/add";

export function CreateTableRedirect() {
  const { search, hash } = useLocation();
  return <Navigate replace to={`${CREATE_TABLE_PATH}${search}${hash}`} />;
}
