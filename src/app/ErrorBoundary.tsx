/**
 * App-global React ErrorBoundary and shared error fallback UI (#81).
 *
 * When an exception occurs during render, the `ErrorBoundary` class component catches
 * throws in the subtree and displays a Korean fallback screen (with refresh action).
 * The same fallback is also reused in the router `errorElement`.
 *
 * Every fallback shows the error's id and the deployment's support contact (#839); the
 * console line for the error starts with the same id.
 */
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { useRouteError } from "react-router-dom";
import { i18n } from "@/shared/i18n";
import {
  getSupportContact,
  newErrorId,
  reportClientError,
  reportHref,
} from "@/shared/lib/clientErrors";

/**
 * The error's id and how to report it (#839).
 *
 * @param id - The id the console line for this error carries.
 * @returns The id, selectable, and the support link when one is configured.
 */
export function ErrorReport({ id }: { id: string }) {
  const contact = getSupportContact();
  return (
    <div className="flex max-w-md flex-col items-center gap-1 text-xs leading-5 text-muted-foreground">
      <p>
        {i18n.t("errorBoundary.report.idLabel")}{" "}
        <code className="select-all rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
          {id}
        </code>
      </p>
      {contact ? (
        <p>
          {i18n.t("errorBoundary.report.withContact")}{" "}
          <a
            href={reportHref(contact, id)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-text underline underline-offset-2"
          >
            {i18n.t("errorBoundary.report.contact", { contact: contact.label })}
          </a>
        </p>
      ) : (
        <p>{i18n.t("errorBoundary.report.withoutContact")}</p>
      )}
    </div>
  );
}

/**
 * Fallback screen shown when an error occurs.
 *
 * @param errorId - The caught error's id, shown with the support contact (#839).
 * @returns Error guidance UI with refresh action.
 */
export function ErrorFallback({ errorId }: { errorId: string }) {
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
        className="inline-flex items-center justify-center rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-medium text-brand-primary-foreground shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {i18n.t("errorBoundary.global.reload")}
      </button>
      <ErrorReport id={errorId} />
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
  const [errorId] = useState(() => newErrorId());
  useEffect(() => {
    reportClientError(errorId, "route", error);
  }, [errorId, error]);
  return <ErrorFallback errorId={errorId} />;
}

interface ErrorBoundaryProps {
  /** Subtree to protect */
  children: ReactNode;
}

interface ErrorBoundaryState {
  /** Whether exception occurred in subtree */
  hasError: boolean;
  /** The caught error's id (#839); null while nothing has been caught. */
  errorId: string | null;
}

/**
 * App-global ErrorBoundary that catches render exceptions in subtree and replaces with fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, errorId: null };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true, errorId: newErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError(this.state.errorId ?? "unknown", "render", error, info.componentStack ?? undefined);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback errorId={this.state.errorId ?? "unknown"} />;
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
function FeatureErrorFallback({
  feature,
  errorId,
  onRetry,
}: {
  feature: string;
  errorId: string;
  onRetry: () => void;
}) {
  return (
    <div
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
        className="inline-flex items-center justify-center rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-medium text-brand-primary-foreground shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {i18n.t("errorBoundary.feature.retry")}
      </button>
      <ErrorReport id={errorId} />
    </div>
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
  state: ErrorBoundaryState = { hasError: false, errorId: null };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true, errorId: newErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError(
      this.state.errorId ?? "unknown",
      "feature",
      error,
      `${this.props.feature}${info.componentStack ?? ""}`,
    );
  }

  private readonly handleRetry = () => this.setState({ hasError: false, errorId: null });

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <FeatureErrorFallback
          feature={this.props.feature}
          errorId={this.state.errorId ?? "unknown"}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
