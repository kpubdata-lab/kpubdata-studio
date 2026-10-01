/**
 * `zod`, with its JIT turned off before any schema is built (#663).
 *
 * zod 4 probes `new Function("")` once to decide whether it may compile object parsers.
 * Under the Content-Security-Policy (no `'unsafe-eval'`) the probe throws, which zod
 * catches — but the browser still reports a CSP violation. `jitless` skips the probe;
 * parsing takes the interpreted path, which the policy would force anyway.
 *
 * The flag has to be set before the first `z.object(...)` runs, and those run as schema
 * modules are evaluated, in whatever chunk the bundler put them. So `vite.config.ts`
 * resolves the bare `zod` specifier to this module: every importer of `zod` imports this
 * first, and ES module order runs `config` before any importer's body. It re-exports
 * `zod/v4`, the same API as the package root.
 */
import { config } from "zod/v4";

config({ jitless: true });

export * from "zod/v4";
export { default } from "zod/v4";
