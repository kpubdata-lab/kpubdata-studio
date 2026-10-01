/**
 * Common Stepper component.
 *
 * Display progress of multi-step flow like New Build Wizard. Each step has
 * upcoming/current/complete/error state, with aria-current="step" on current stage
 * for assistive tech positioning (accessibility, proposal §12).
 */
import { cn } from "./cn";

export type StepState = "upcoming" | "current" | "complete" | "error";

export interface StepItem {
  /** stage identifier */
  id: string;
  /** step label (Korean) */
  label: string;
}

export interface StepperProps {
  /** list of stages to display (in order) */
  steps: StepItem[];
  /** 0-based index of current active stage */
  current: number;
  /** set of stage indices where error occurred (optional) */
  errorSteps?: number[];
  /** handler to allow navigation on step click (completed steps only) */
  onStepClick?: (index: number) => void;
  /** additional className */
  className?: string;
  /** accessible name of the step list */
  label?: string;
}

function resolveState(index: number, current: number, errorSteps: number[]): StepState {
  if (errorSteps.includes(index)) return "error";
  if (index < current) return "complete";
  if (index === current) return "current";
  return "upcoming";
}

const STATE_CIRCLE: Record<StepState, string> = {
  upcoming: "border-border text-muted-foreground",
  current: "border-brand-primary bg-brand-primary text-brand-primary-foreground",
  complete: "border-status-success bg-status-success-solid text-white",
  error: "border-status-failure bg-status-failure-solid text-white",
};

/**
 * Render horizontal step indicator for multi-step flow progress.
 *
 * @param props - steps/current/errorSteps/onStepClick.
 * @returns Stepper element.
 */
export function Stepper({
  steps,
  current,
  errorSteps = [],
  onStepClick,
  className,
  label,
}: StepperProps) {
  // if current is out of bounds (e.g., terminal value after last stage), clamp to last stage
  // prevent issue where no stage is marked current and aria-current disappears(#74).
  const clampedCurrent = steps.length === 0 ? 0 : Math.min(Math.max(current, 0), steps.length - 1);
  return (
    <ol aria-label={label} className={cn("flex w-full items-center gap-2 overflow-x-auto", className)}>
      {steps.map((step, index) => {
        const state = resolveState(index, clampedCurrent, errorSteps);
        const clickable = Boolean(onStepClick) && index < clampedCurrent;
        const circle = (
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              STATE_CIRCLE[state],
            )}
            aria-hidden="true"
          >
            {state === "complete" ? "✓" : state === "error" ? "!" : index + 1}
          </span>
        );

        return (
          <li
            key={step.id}
            aria-current={state === "current" ? "step" : undefined}
            className="flex min-w-fit items-center gap-2"
          >
            {clickable ? (
              <button
                type="button"
                onClick={() => onStepClick?.(index)}
                className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {circle}
                <span className="whitespace-nowrap text-sm font-medium text-foreground">
                  {step.label}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {circle}
                <span
                  className={cn(
                    "whitespace-nowrap text-sm font-medium",
                    state === "upcoming"
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {step.label}
                </span>
              </div>
            )}
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="h-px w-6 bg-border" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
