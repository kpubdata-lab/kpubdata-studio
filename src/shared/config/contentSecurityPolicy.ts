/**
 * Studio's Content-Security-Policy (#663).
 *
 * Without a policy, one XSS — a compromised dependency, say — can run any script and
 * read everything the page holds, the opted-in LLM API key in localStorage included
 * (#619). The policy allows only scripts and styles served by Studio itself, so an
 * injected inline script or a script from another origin does not run.
 *
 * Where it is delivered:
 * - Every `vite build` (GitHub Pages demo, release tarball, `vite preview`) gets it as a
 *   `<meta http-equiv>` in `index.html` (the Vite plugin in `vite.config.ts`).
 * - The container image builds without the meta and sends it as a response header
 *   instead (`docker/nginx.conf`), written at start by `docker/40-kpubdata-config.sh`
 *   with that deployment's Builder and OIDC origins added. The shell copy of this policy
 *   is checked against this one by `__tests__/contentSecurityPolicy.test.ts`.
 * - The dev server sends none: React Fast Refresh injects an inline script.
 *
 * Why each source is there:
 * - `connect-src https:` — the Builder URL and OIDC issuer are runtime settings
 *   (`config.js`), and Ask KPubData's BYOK base URL can be any HTTPS address the user
 *   enters (`features/assistant/baseUrl.ts`). No fixed origin list can know them.
 *   `http://localhost:*` / `http://127.0.0.1:*` keep a local Builder or Keycloak working.
 * - `frame-src` — the silent SSO check loads the issuer's authorization endpoint in a
 *   hidden iframe, which then lands on Studio's own `silent-check-sso.html`.
 * - `img-src data:` — Vite inlines small images (the favicon) as data URLs.
 * - `style-src 'self'` — every style is a stylesheet or set through the CSSOM; no
 *   `<style>` element or `style=""` markup is rendered.
 * - `frame-ancestors` — header only; a meta element cannot carry it.
 */

/** Sources a browser running a local Builder or Keycloak over plain HTTP needs. */
const LOCAL_HTTP = ["http://localhost:*", "http://127.0.0.1:*"] as const;

export const CSP_DIRECTIVES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'"]],
  ["style-src", ["'self'"]],
  ["img-src", ["'self'", "data:"]],
  ["font-src", ["'self'"]],
  ["connect-src", ["'self'", "https:", ...LOCAL_HTTP]],
  ["frame-src", ["'self'", "https:", ...LOCAL_HTTP]],
  ["worker-src", ["'self'"]],
  ["manifest-src", ["'self'"]],
  ["object-src", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["form-action", ["'self'"]],
];

/**
 * The policy as one header or meta value.
 *
 * @param options.header - Add the directives only a response header can carry.
 */
export function contentSecurityPolicy({ header = false }: { header?: boolean } = {}): string {
  const directives = header ? [...CSP_DIRECTIVES, ["frame-ancestors", ["'self'"]] as const] : CSP_DIRECTIVES;
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}
