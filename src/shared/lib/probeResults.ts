/**
 * The last key-probe result per provider, held for the signed-in account (#905).
 *
 * Memory only — a module-level map, never localStorage, sessionStorage, IndexedDB, a
 * cookie or the server. It survives moving between screens and is gone on a reload.
 * Each entry carries the storage owner (`iss#sub`) it was made for: another account's
 * result is never returned, and the entries are dropped when the owner changes
 * (`app/ownerSessionReset.ts`) or the key it was made with is forgotten or replaced
 * (`providerKeys.ts`). The owner is passed in rather than read here so that this module
 * stays free of the auth store, which imports `providerKeys`.
 */
import type { ProviderProbeResponse } from "./builderApi";

const held = new Map<string, { owner: string; result: ProviderProbeResponse }>();

function normalize(provider: string): string {
  return provider.trim().toLowerCase();
}

/** The held result for `provider`, only when it was made for `owner`. */
export function heldProbeResult(owner: string, provider: string): ProviderProbeResponse | null {
  const entry = held.get(normalize(provider));
  return entry && entry.owner === owner ? entry.result : null;
}

/** Hold `result` for `owner`'s `provider`. */
export function holdProbeResult(owner: string, provider: string, result: ProviderProbeResponse): void {
  held.set(normalize(provider), { owner, result });
}

/** Forget the result for `provider`, if any. */
export function forgetProbeResult(provider: string): void {
  held.delete(normalize(provider));
}

/** Forget every held result (sign-out, another account). */
export function forgetAllProbeResults(): void {
  held.clear();
}
