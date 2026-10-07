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
import { isMap, isScalar, parseDocument, Scalar, visit, type Document } from "yaml";
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

/** React hook: whether a key is held for every one of `providers` (false for none). */
export function useEveryProviderKeyHeld(providers: readonly string[]): boolean {
  return useHeldProviderKeysStore(
    (state) => providers.length > 0 && providers.every((provider) => normalizeProvider(provider) in state.keys),
  );
}

/**
 * Which provider's key each provider calls with, as Builder says in `GET /providers`
 * (`key_provider`, kpubdata-builder#1085, contract 1.98.0): its own, or the one it shares
 * a key with (several providers call with data.go.kr's). Which ones is Builder's to say.
 *
 * Studio kept a copy of that table (#770) with nothing holding the two together. It is
 * now only what Builder last said. `null` until Builder has said: before the provider
 * list is first loaded, and for a Builder older than that contract.
 */
let keyProviderOf: ReadonlyMap<string, string> | null = null;

/** Remember what one `GET /providers` answer says about whose key each provider uses. */
export function noteKeyProviders(providers: ReadonlyArray<{ provider: string; key_provider?: string }>): void {
  const told = providers.filter((item) => typeof item.key_provider === "string" && item.key_provider);
  // An older Builder says nothing; what is known is kept rather than forgotten.
  if (told.length === 0) return;
  keyProviderOf = new Map(told.map((item) => [normalizeProvider(item.provider), normalizeProvider(item.key_provider as string)]));
}

/**
 * The provider whose key `provider` calls with — itself, unless Builder has said it
 * shares another's. That is the key to ask the user for when Builder says `provider` is
 * missing one (#787).
 */
export function keyProviderFor(provider: string): string {
  const id = normalizeProvider(provider);
  return keyProviderOf?.get(id) ?? id;
}

/** Test helper: forget what Builder said. */
export function forgetKeyProviders(): void {
  keyProviderOf = null;
}

/**
 * How Builder reads a BuildSpec (#788). It parses with PyYAML's `safe_load`, which is
 * YAML 1.1: a `<<` key merges the mappings it names, a key written twice keeps its last
 * value, and aliases are followed without a limit. This library's defaults are YAML 1.2
 * — no merge, a repeated key is an error, at most 100 alias uses — so a spec Builder
 * accepts was read here as naming no provider, and its request went out without the key.
 *
 * `specProviders.cases.ts` holds each case with what PyYAML reads from it, and
 * `specProviders.test.ts` holds this reader to those answers.
 */
const AS_BUILDER_READS = { version: "1.1", uniqueKeys: false } as const;

/**
 * The spec's key cannot be decided here the way Builder would decide it: a mapping has
 * more than one `<<` key. PyYAML lets the later one win and this library the earlier, so
 * the two could name different providers — and the request would carry the wrong key or
 * none. The request is not sent; the user is told to write one merge.
 */
export class AmbiguousSpecError extends Error {
  constructor() {
    super("a mapping in the spec has more than one '<<' merge key");
    this.name = "AmbiguousSpecError";
  }
}

/** An unquoted `<<` key. Under YAML 1.1 the parser gives its value as a symbol. */
function isMergeKey(key: unknown): boolean {
  if (!isScalar(key) || (key.type && key.type !== Scalar.PLAIN)) return false;
  const value: unknown = key.value;
  return value === "<<" || (typeof value === "symbol" && value.description === "<<");
}

function hasRepeatedMergeKey(document: Document): boolean {
  let found = false;
  visit(document, {
    Map(_key, map) {
      if (map.items.filter((pair) => isMergeKey(pair.key)).length > 1) {
        found = true;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return found;
}

/**
 * The providers a BuildSpec's sources call, read from its YAML as Builder reads it. A
 * spec that cannot be read names none: Builder refuses it before any provider is called,
 * so no key is needed.
 *
 * @throws AmbiguousSpecError when Builder could read a different provider than this does.
 */
export function specProviders(specYaml: string): string[] {
  let parsed: unknown;
  try {
    const document = parseDocument(specYaml, AS_BUILDER_READS);
    if (document.errors.length > 0) return [];
    if (isMap(document.contents) && hasRepeatedMergeKey(document)) throw new AmbiguousSpecError();
    // No alias limit: Builder has none, and only `sources[].provider` is read here.
    parsed = document.toJS({ maxAliasCount: -1 });
  } catch (cause) {
    if (cause instanceof AmbiguousSpecError) throw cause;
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
 *   key of the provider Builder says it shares one with (#770). A request for seoul data
 *   does not carry the datago key through every proxy on the way.
 * - With `providers`, before Builder has said whose key a provider uses: every held key.
 *   Leaving a key out on a guess would fail the request for a key the user does hold.
 * - Without: every held key. That is for the one call that asks what the held keys
 *   cover (`GET /providers`).
 */
export function providerKeyHeaders(providers?: readonly string[]): Record<string, string> {
  const held = useHeldProviderKeysStore.getState().keys;
  let entries = Object.entries(held);
  if (providers !== undefined && keyProviderOf !== null) {
    const known = keyProviderOf;
    const wanted = new Set<string>();
    for (const provider of providers) {
      const id = normalizeProvider(provider);
      wanted.add(id);
      const shared = known.get(id);
      if (shared) wanted.add(shared);
    }
    entries = entries.filter(([id]) => wanted.has(id));
  }
  if (entries.length === 0) return {};
  return { [PROVIDER_KEY_HEADER]: entries.map(([id, value]) => `${id}=${value}`).join(",") };
}
