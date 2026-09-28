/**
 * Top-level app component that assembles global application Providers.
 *
 * Currently connects React Router so all pages share the same routing context.
 */
import { RouterProvider } from "react-router-dom";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { router } from "@/app/router";
import { useThemeEffect } from "@/shared/hooks/useThemeEffect";

/**
 * Root component wrapping entire Studio in Router context.
 *
 * Wraps in global ErrorBoundary to prevent render-time throws from blanking the SPA (#81).
 * Applies saved theme to document so light/dark selection takes effect in actual UI (#96).
 *
 * @returns Router rendering result with global Providers applied.
 */
export function App() {
  useThemeEffect();
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
