/**
 * Whether Studio runs as the demo, without a Builder (#902).
 *
 * The one place a screen asks this. It is for what changes only because no Builder is
 * attached — the shell's demo banner, signing in, the version banner, the account and
 * administration screens, a notice that the demo has no uploads or data cards. A screen
 * that reads data asks its feature's client instead (`ARCHITECTURE.md` §5, the one client
 * interface, #794), so the demo and a Builder answer it through one interface.
 * `scripts/real-builder-switch.mjs` lists the files that may ask.
 */
import { isRealBuilderEnabled } from "./builderApi";

export function isDemo(): boolean {
  return !isRealBuilderEnabled();
}
