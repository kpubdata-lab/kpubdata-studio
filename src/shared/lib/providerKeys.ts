/**
 * Provider keys held for this page load only (#652, kpubdata-builder#683, contract 1.56.0).
 *
 * A multi-user Builder does not store provider keys: `PUT /providers/{provider}/credential`
 * answers 403 `credential_storage_disabled`, and a key must arrive with each request that
 * calls a provider, in the `X-Provider-Key` header (`<provider>=<key>`, comma-separated).
 * Studio keeps such a key here, in a module-level store:
 *
 * - memory only — no persist middleware, never localStorage, sessionStorage, IndexedDB,
 *   a cookie, the URL or a log (BYOK, POLICY 1.2, #410); a reload or sign-out forgets it;
 * - sent only by the Builder calls that build a provider client (see `builderApi`),
 *   never in a URL query and never part of an error message.
 *
 * A single-user Builder stores keys as before, so nothing is held here and no header is
 * sent: its flow is unchanged.
 */
import { parse as parseYaml } from "yaml";
import { create } from "zustand";

/** The request header that carries provider keys (builder `request_credentials.py`). */
export const PROVIDER_KEY_HEADER = "X-Provider-Key";

interface HeldProviderKeysState {
  /** Provider id (lower case) → key. Never read outside this module but by the header builder. */
  keys: Readonly<Record<string, string>>;
}

const useHeldProviderKeysStore = create<HeldProviderKeysState>(() => ({ keys: {} }));

/** Why a key cannot be carried in the header. */
export type ProviderKeyProblem = "empty" | "unsupported_character";

/**
 * Check that `value` survives the header's `<provider>=<key>` comma-separated form.
 * A comma would split it into two items, and a control or non-Latin-1 character is not a
 * valid header byte, so either would reach Builder as a different key — or not at all.
 */
export function providerKeyProblem(value: string): ProviderKeyProblem | null {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  // eslint-disable-next-line no-control-regex
  if (/[,\u0000-\u001f\u007f]/.test(trimmed) || /[^\u0000-ÿ]/.test(trimmed)) {
    return "unsupported_character";
  }
  return null;
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

/**
 * Hold `value` as this page load's key for `provider`. Returns false, holding nothing,
 * when the value cannot travel in the header (`providerKeyProblem`).
 */
export function holdProviderKey(provider: string, value: string): boolean {
  const id = normalizeProvider(provider);
  if (!id || providerKeyProblem(value)) return false;
  useHeldProviderKeysStore.setState((state) => ({ keys: { ...state.keys, [id]: value.trim() } }));
  return true;
}

/** Forget the held key for `provider`, if any. */
export function forgetProviderKey(provider: string): void {
  const id = normalizeProvider(provider);
  useHeldProviderKeysStore.setState((state) => {
    if (!(id in state.keys)) return state;
    const next = { ...state.keys };
    delete next[id];
    return { keys: next };
  });
}

/** Forget every held key (sign-out). */
export function forgetAllProviderKeys(): void {
  useHeldProviderKeysStore.setState({ keys: {} });
}

/** Whether a key is held for `provider` — never the key itself. */
export function isProviderKeyHeld(provider: string): boolean {
  return normalizeProvider(provider) in useHeldProviderKeysStore.getState().keys;
}

/** React view of `isProviderKeyHeld`, re-rendering when the held set changes. */
export function useProviderKeyHeld(provider: string | null | undefined): boolean {
  return useHeldProviderKeysStore((state) =>
    provider ? normalizeProvider(provider) in state.keys : false,
  );
}

/**
 * Providers that call with another provider's key. Builder keeps the same table
 * (`_CLIENT_KEY_SLOT` in kpubdata-builder `service/providers.py`) and looks a request's
 * key up under either name; the contract does not publish it, so it is repeated here.
 * A provider missing from this table only loses the shared key — its own is still sent.
 */
const SHARED_KEY_OF: Readonly<Record<string, string>> = {
  localdata: "datago",
  lofin: "datago",
  semas: "datago",
};

/**
 * The providers a BuildSpec's sources call, read from its YAML. A spec that cannot be
 * read names none: Builder refuses it before any provider is called, so no key is needed.
 */
export function specProviders(specYaml: string): string[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(specYaml);
  } catch {
    return [];
  }
  const sources = (parsed as { sources?: unknown } | null)?.sources;
  if (!Array.isArray(sources)) return [];
  const names = new Set<string>();
  for (const source of sources) {
    const provider = (source as { provider?: unknown } | null)?.provider;
    if (typeof provider === "string" && provider.trim()) names.add(normalizeProvider(provider));
  }
  return [...names];
}

/**
 * The `X-Provider-Key` header, or no header when no key it would carry is held.
 *
 * - With `providers`: only the keys those providers call with — each one's own, and the
 *   key of the provider it shares one with (#770). A request for seoul data does not
 *   carry the datago key through every proxy on the way.
 * - Without: every held key. That is for the one call that asks what the held keys
 *   cover (`GET /providers`).
 */
export function providerKeyHeaders(providers?: readonly string[]): Record<string, string> {
  const held = useHeldProviderKeysStore.getState().keys;
  let entries = Object.entries(held);
  if (providers !== undefined) {
    const wanted = new Set<string>();
    for (const provider of providers) {
      const id = normalizeProvider(provider);
      wanted.add(id);
      const shared = SHARED_KEY_OF[id];
      if (shared) wanted.add(shared);
    }
    entries = entries.filter(([id]) => wanted.has(id));
  }
  if (entries.length === 0) return {};
  return { [PROVIDER_KEY_HEADER]: entries.map(([id, value]) => `${id}=${value}`).join(",") };
}
