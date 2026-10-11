/**
 * `zod/mini`, with its JIT turned off and its English messages in place before any schema
 * is built (#663, #951).
 *
 * zod 4 probes `new Function("")` once to decide whether it may compile object parsers.
 * Under the Content-Security-Policy (no `'unsafe-eval'`) the probe throws, which zod
 * catches — but the browser still reports a CSP violation. `jitless` skips the probe;
 * parsing takes the interpreted path, which the policy would force anyway.
 *
 * Studio uses `zod/mini` rather than the classic `zod` API (#951): the same zod 4 engine
 * with functions instead of methods, so the bundle carries only what the schemas use and
 * not every method and the JSON Schema converter. Classic zod sets the English locale on
 * its own; mini does not, so it is set here — the messages a user sees
 * (`issues[0].message`) stay the ones classic zod gave.
 *
 * Both settings have to be in place before the first `z.object(...)` runs, and those run
 * as schema modules are evaluated, in whatever chunk the bundler put them. So
 * `vite.config.ts` (and `vitest.config.ts`) resolve the `zod/mini` specifier to this
 * module: every importer of `zod/mini` imports this first, and ES module order runs
 * `config` before any importer's body. It re-exports `zod/v4/mini`, the same API.
 */
import { config } from "zod/v4/mini";
import en from "zod/v4/locales/en.js";

config({ jitless: true, ...en() });

export * from "zod/v4/mini";
