/**
 * What to show when a build or a preview needs a provider key it does not have (#787).
 *
 * Builder says which providers need a key (`provider_credential_required`), or that a
 * finished run lost its keys (`credentials_required`). Either way the user has to give a
 * key and start the build again — and must not lose the spec they were about to run.
 *
 * - Where keys travel with each request (a multi-user deployment), the key is entered
 *   **here**: it is held in this tab's memory, exactly as the Connections page holds it,
 *   and the form the user is on stays as it is. A link to Connections is offered too,
 *   with a way back.
 * - Where Builder stores keys, a key cannot be given from here: only the link is shown,
 *   and it says that what is on this page may not be kept.
 *
 * A provider that calls with another's key (`localdata` with `datago`'s) asks for that
 * one, once, however many providers share it. Nothing typed here is sent anywhere by
 * this component, logged, or put in the URL.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  holdProviderKey,
  keyProviderFor,
  useEveryProviderKeyHeld,
  useProviderKeyHeld,
} from "@/shared/lib/providerKeys";
import type { MissingProviderKeys } from "@/shared/lib/missingProviderKey";
import { Button, Card } from "@/shared/ui";

export interface MissingProviderKeyNoticeProps {
  /** The providers that need a key and where a key goes in this deployment. */
  missing: MissingProviderKeys;
  /** Why the key is asked for: the request was refused, or a finished run lost it. */
  reason: "refused" | "lost";
  /** The path to come back to from the Connections page. */
  returnTo: string;
}

/** The distinct keys to ask for: each provider's own, or the one it shares. */
export function keysToAskFor(providers: readonly string[]): Array<{ keyProvider: string; usedBy: string[] }> {
  const byKey = new Map<string, string[]>();
  for (const provider of providers) {
    const keyProvider = keyProviderFor(provider);
    byKey.set(keyProvider, [...(byKey.get(keyProvider) ?? []), provider]);
  }
  return [...byKey.entries()].map(([keyProvider, usedBy]) => ({ keyProvider, usedBy }));
}

function connectionsHref(provider: string, returnTo: string): string {
  return `/connections?provider=${encodeURIComponent(provider)}&returnTo=${encodeURIComponent(returnTo)}`;
}

function KeyEntry({ keyProvider, usedBy, returnTo }: { keyProvider: string; usedBy: string[]; returnTo: string }) {
  const { t } = useTranslation();
  const held = useProviderKeyHeld(keyProvider);
  const [value, setValue] = useState("");
  const [rejected, setRejected] = useState(false);
  const inputId = `missing-provider-key-${keyProvider}`;
  const borrowers = usedBy.filter((provider) => provider !== keyProvider);

  if (held) {
    return (
      <li className="text-sm" data-key-held={keyProvider}>
        {t("provider.missingKey.held", { provider: keyProvider })}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2" data-key-needed={keyProvider}>
      {borrowers.map((provider) => (
        <p className="text-xs text-muted-foreground" key={provider}>
          {t("provider.missingKey.sharedKey", { provider, keyProvider })}
        </p>
      ))}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // Held in memory or refused; never sent from here.
          if (holdProviderKey(keyProvider, value)) {
            setValue("");
            setRejected(false);
          } else {
            setRejected(true);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor={inputId}>
          {t("provider.missingKey.keyLabel", { provider: keyProvider })}
          <input
            autoComplete="off"
            className="w-72 max-w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-normal"
            id={inputId}
            onChange={(event) => {
              setValue(event.target.value);
              setRejected(false);
            }}
            type="password"
            value={value}
          />
        </label>
        <Button disabled={value.trim().length === 0} type="submit" variant="secondary">
          {t("provider.missingKey.use")}
        </Button>
        <Link className="text-xs underline" to={connectionsHref(keyProvider, returnTo)}>
          {t("provider.missingKey.openConnections", { provider: keyProvider })}
        </Link>
      </form>
      {rejected ? (
        <p className="text-sm text-status-failure" role="alert">
          {t("provider.errors.keyUnsupported")}
        </p>
      ) : null}
    </li>
  );
}

export function MissingProviderKeyNotice({ missing, reason, returnTo }: MissingProviderKeyNoticeProps) {
  const { t } = useTranslation();
  const keys = keysToAskFor(missing.providers);
  const allHeld = useEveryProviderKeyHeld(keys.map(({ keyProvider }) => keyProvider));

  return (
    <Card className="mt-3 p-4" data-missing-provider-keys={missing.providers.join(",")} variant="error">
      <h4 className="text-sm font-semibold">{t("provider.missingKey.title")}</h4>
      <p className="mt-1 text-sm">
        {reason === "lost"
          ? t("provider.missingKey.lost")
          : t("provider.missingKey.refused", { providers: missing.providers.join(", ") })}
      </p>
      {reason === "lost" ? <p className="mt-1 text-sm">{t("provider.missingKey.lostNext")}</p> : null}

      {missing.keptIn === "stored" ? (
        <>
          <p className="mt-2 text-sm">{t("provider.missingKey.storedHint")}</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {keys.map(({ keyProvider }) => (
              <li key={keyProvider}>
                <Link className="underline" to={connectionsHref(keyProvider, returnTo)}>
                  {t("provider.missingKey.openConnections", { provider: keyProvider })}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-3">
            {keys.map(({ keyProvider, usedBy }) => (
              <KeyEntry key={keyProvider} keyProvider={keyProvider} returnTo={returnTo} usedBy={usedBy} />
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {allHeld ? t("provider.missingKey.allHeld") : t("provider.missingKey.memoryOnly")}
          </p>
        </>
      )}
    </Card>
  );
}
