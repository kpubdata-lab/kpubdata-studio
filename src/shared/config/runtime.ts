/**
 * Deployment configuration read at runtime, not baked in at build time (#411).
 *
 * The release image is one image for every deployment, and each deployment has its
 * own Builder URL and OIDC realm. The container writes `/config.js` at start from its
 * environment (`docker/40-kpubdata-config.sh`), and `index.html` loads it before the
 * bundle, so the values are on `window` by the time any module reads them.
 *
 * A value missing from the runtime config falls back to the build-time `VITE_*`
 * variable, which is how `npm run dev` and the GitHub Pages demo keep working: their
 * `config.js` is the empty one in `public/`.
 */

/** Shape of `window.__KPUBDATA_CONFIG__`. Every field is optional. */
export interface RuntimeConfig {
  builderApiUrl?: string;
  useRealBuilder?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  /** Where the deployment publishes its privacy policy and terms of use (#838). */
  privacyUrl?: string;
  termsUrl?: string;
  /** A mail address or an https page users write to (#839, #838). */
  supportContact?: string;
  /** The identity provider's account page; `<issuer>/account` when unset (#838). */
  accountUrl?: string;
}

declare global {
  interface Window {
    __KPUBDATA_CONFIG__?: RuntimeConfig;
  }
}

/** An empty string is "not set" — `-e BUILDER_API_URL=` must not mean "call ''". */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Pick the runtime value when the container supplied one, else the build-time value.
 *
 * @param key - Field of the runtime config.
 * @param buildTime - The `import.meta.env.VITE_*` value for the same setting.
 */
export function runtimeOr(key: keyof RuntimeConfig, buildTime: string | undefined): string | undefined {
  const runtime = typeof window === "undefined" ? undefined : window.__KPUBDATA_CONFIG__;
  return nonEmpty(runtime?.[key]) ?? buildTime;
}
