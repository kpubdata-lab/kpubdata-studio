/**
 * TypeScript ambient declaration file notifying Vite-injected global type declarations.
 *
 * Includes base types so Vite-only APIs like `import.meta.env` can be used safely.
 */
/// <reference types="vite/client" />

/** Custom `VITE_*` environment variables used by Studio (#74). */
interface ImportMetaEnv {
  /** Builder API base URL. Falls back to local default if unset. */
  readonly VITE_BUILDER_API_URL?: string;
  /** If "true", call real Builder API instead of mock. */
  readonly VITE_USE_REAL_BUILDER?: string;
  /** Development-server-only real Builder login-gate bypass. */
  readonly VITE_DEV_BYPASS_AUTH?: string;
  /** OIDC issuer URL (e.g., http://localhost:8080/realms/kpubdata). Public value. */
  readonly VITE_OIDC_ISSUER?: string;
  /** OIDC public SPA client id (e.g., kpubdata-studio). Public value — NOT client secret. */
  readonly VITE_OIDC_CLIENT_ID?: string;
  /** Studio's own version, injected from `package.json` by vite `define` (#430). */
  readonly VITE_APP_VERSION?: string;
  /** Where users report errors (#839): a mail address or an https page. Public value. */
  readonly VITE_SUPPORT_CONTACT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
