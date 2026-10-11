/**
 * The first-run checklist (#412): the four things a new user does before the first
 * table exists — apply for the data, enter the key, check what the key reaches, make
 * the table.
 *
 * It is a card in the page, not a tour over the screen: Home shows no overlay (#527),
 * and each step is done on another page, so the user has to be able to leave and come
 * back. A step is ticked by the user. Studio cannot tick the first three itself: the
 * application is made on the provider's site, and a key is held for the session only,
 * so after a reload nothing says one was ever entered.
 *
 * Closing the card and the ticks are remembered in this browser, per account. Once
 * closed, the card is one small button that opens it again.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { HELP_URL } from "@/shared/config/policyLinks";
import { BetaBadge } from "@/shared/ui/BetaBadge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { SupportLine } from "@/shared/ui/PolicyLinks";

export const ONBOARDING_STORAGE_KEY_PREFIX = "kpubdata:onboarding:v2";
const REPLAY_EVENT = "kpubdata:onboarding:replay";

/** Holds "complete" once the account has closed the checklist. */
export function onboardingStorageKey(userId: string): string {
  return `${ONBOARDING_STORAGE_KEY_PREFIX}:${userId}`;
}

/** Holds the ids of the steps the account has ticked, as a JSON array. */
export function onboardingStepsStorageKey(userId: string): string {
  return `${onboardingStorageKey(userId)}:steps`;
}

/** In order. Each step links to the page where it is done. */
const STEPS = [
  { id: "apply", to: "/connections" },
  { id: "key", to: "/connections" },
  { id: "probe", to: "/connections" },
  { id: "table", to: "/discover" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function isDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(onboardingStorageKey(userId)) === "complete";
  } catch {
    return false;
  }
}

function readDoneSteps(userId: string): StepId[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(onboardingStepsStorageKey(userId)) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return STEPS.map((step) => step.id).filter((id) => stored.includes(id));
  } catch {
    return [];
  }
}

/** Opens the checklist again for `userId` (for every account when omitted). */
export function resetFirstRunTour(userId?: string) {
  if (userId !== undefined) {
    try {
      localStorage.removeItem(onboardingStorageKey(userId));
    } catch {
      // The card still opens for this visit when storage is unavailable.
    }
  }
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: userId }));
}

export function FirstRunTour({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => !isDismissed(userId));
  const [done, setDone] = useState<StepId[]>(() => readDoneSteps(userId));

  useEffect(() => {
    const replay = (event: Event) => {
      const requested = (event as CustomEvent<unknown>).detail;
      if (typeof requested === "string" && requested !== userId) return;
      setOpen(true);
    };
    window.addEventListener(REPLAY_EVENT, replay);
    return () => window.removeEventListener(REPLAY_EVENT, replay);
  }, [userId]);

  function dismiss() {
    try {
      localStorage.setItem(onboardingStorageKey(userId), "complete");
    } catch {
      // Without storage the card is closed for this visit only.
    }
    setOpen(false);
  }

  function toggle(id: StepId, checked: boolean) {
    const next = STEPS.map((step) => step.id).filter((step) => (step === id ? checked : done.includes(step)));
    try {
      localStorage.setItem(onboardingStepsStorageKey(userId), JSON.stringify(next));
    } catch {
      // Without storage the ticks last for this visit only.
    }
    setDone(next);
  }

  if (!open) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => resetFirstRunTour(userId)}>
          {t("onboarding.checklist.reopen")}
        </Button>
      </div>
    );
  }

  return (
    <Card aria-labelledby="first-run-title" data-testid="first-run-checklist" role="region">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold" id="first-run-title">
              {t("onboarding.checklist.title")}
            </h2>
            <BetaBadge />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.checklist.desc")}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          {t("onboarding.checklist.dismiss")}
        </Button>
      </div>

      <ol className="mt-4 space-y-3">
        {STEPS.map((step, index) => {
          const inputId = `first-run-step-${step.id}`;
          return (
            <li className="flex min-w-0 items-start gap-3" key={step.id}>
              <input
                checked={done.includes(step.id)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-primary"
                id={inputId}
                onChange={(event) => toggle(step.id, event.target.checked)}
                type="checkbox"
              />
              <div className="min-w-0 text-sm">
                <label className="font-medium" htmlFor={inputId}>
                  {index + 1}. {t(`onboarding.checklist.steps.${step.id}.title`)}
                </label>
                <p className="mt-0.5 text-muted-foreground">
                  {t(`onboarding.checklist.steps.${step.id}.copy`)}{" "}
                  <Link className="font-medium text-brand-text underline underline-offset-2" to={step.to}>
                    {t(`onboarding.checklist.steps.${step.id}.cta`)}
                  </Link>
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
        <p>
          {t("onboarding.checklist.beta")}{" "}
          <a
            className="font-medium text-brand-text underline underline-offset-2"
            href={HELP_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("onboarding.checklist.guide")}
          </a>
        </p>
        <SupportLine className="mt-1" />
      </div>
    </Card>
  );
}
