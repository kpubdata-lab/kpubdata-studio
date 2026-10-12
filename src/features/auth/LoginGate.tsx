/** Wire protected Studio routes to /login single entry point. */
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isDevAuthBypassEnabled } from "@/shared/config/env";
import { isDemo } from "@/shared/lib/demoMode";
import { useAuthStore } from "./store";

export function LoginGate({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const oidcStatus = useAuthStore((state) => state.oidcStatus);
  const location = useLocation();

  if (isDemo() || isDevAuthBypassEnabled()) return <>{children}</>;
  if (oidcStatus === "authenticated" || (oidcStatus === "disabled" && token)) return <>{children}</>;

  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`/login?${new URLSearchParams({ returnTo }).toString()}`} replace />;
}
