import type { Plugin } from "vite";

import { contentSecurityPolicy } from "./src/shared/config/contentSecurityPolicy";

/**
 * Put the Content-Security-Policy into the built `index.html` as a meta element (#663).
 * Build only: the dev server's React Fast Refresh preamble is an inline script. The
 * container image sets `KPUBDATA_CSP_META=off` and sends the policy as a header instead
 * (`docker/nginx.conf`), so a meta copy cannot narrow the header's deployment origins.
 */
export function contentSecurityPolicyMeta(): Plugin {
  return {
    name: "kpubdata-csp-meta",
    apply: "build",
    transformIndexHtml() {
      if (process.env.KPUBDATA_CSP_META === "off") return [];
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy() },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
