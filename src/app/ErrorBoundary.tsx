/**
 * App-global React ErrorBoundary and shared error fallback UI (#81).
 *
 * When an exception occurs during render, the `ErrorBoundary` class component catches
 * throws in the subtree and displays a Korean fallback screen (with refresh action).
 * The same fallback is also reused in the router `errorElement`.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouteError } from "react-router-dom";
import { i18n } from "@/shared/i18n";

/**
 * Fallback screen shown when an error occurs.
 *
 * @returns Error guidance UI with refresh action.
 */
export function ErrorFallback() {
  return (
    <main
      role="alert"
      className="flex min-h-screen flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <p className="text-2xl font-semibold tracking-tight text-foreground">
        {i18n.t("errorBoundary.global.title")}
      </p>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        {i18n.t("errorBoundary.global.desc")}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {i18n.t("errorBoundary.global.reload")}
      </button>
    </main>
  );
}

/**
 * Error screen used as router `errorElement`.
 *
 * Logs route loader/action/render errors to console and displays shared fallback.
 *
 * @returns Error fallback UI.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  console.error("Route error:", error);
  return <ErrorFallback />;
}

interface ErrorBoundaryProps {
  /** Subtree to protect */
  children: ReactNode;
}

interface ErrorBoundaryState {
  /** Whether exception occurred in subtree */
  hasError: boolean;
}

/**
 * App-global ErrorBoundary that catches render exceptions in subtree and replaces with fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}

/**
 * Fallback card shown only in a single feature area (#97).
 *
 * Unlike the global fallback, it doesn't occupy the entire screen; instead replaces only
 * the feature area while preserving the shell (sidebar/header). Provides a "Retry" action
 * that re-renders only the area instead of full refresh.
 *
 * @param feature - i18n key of the errored feature (e.g., "router.features.preview").
 * @param onRetry - Callback to reset boundary state and re-render subtree.
 * @returns Feature-scoped error guidance UI.
 */
function FeatureErrorFallback({ feature, onRetry }: { feature: string; onRetry: () => void }) {
  return (
    <main
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <p className="text-lg font-semibold tracking-tight text-foreground">
        {i18n.t("errorBoundary.feature.title", { feature: i18n.t(feature) })}
      </p>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        {i18n.t("errorBoundary.feature.desc")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {i18n.t("errorBoundary.feature.retry")}
      </button>
    </main>
  );
}

interface FeatureErrorBoundaryProps {
  /** i18n key of feature name to show in fallback message */
  feature: string;
  /** Subtree to protect */
  children: ReactNode;
}

/**
 * Feature-scoped ErrorBoundary that catches render exceptions in a route segment and replaces only that area with fallback (#97).
 *
 * Prevents an error in one feature from bubbling up to the global `ErrorBoundary` and blanking the entire app.
 * Instead, one feature's error doesn't affect the rest of the shell (nav/header). On "Retry", only the boundary state resets.
 */
export class FeatureErrorBoundary extends Component<
  FeatureErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Feature error (${this.props.feature}):`, error, info.componentStack);
  }

  private readonly handleRetry = () => this.setState({ hasError: false });

  render(): ReactNode {
    if (this.state.hasError) {
      return <FeatureErrorFallback feature={this.props.feature} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
