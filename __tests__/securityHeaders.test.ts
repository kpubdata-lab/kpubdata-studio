// @vitest-environment jsdom
/**
 * The security headers and the page's language are in what is served (#841).
 *
 * nginx had no Referrer-Policy, Permissions-Policy or Strict-Transport-Security, and
 * `index.html` said `lang="en"` of a page that starts in Korean. `add_header` in a
 * location replaces the server's, so the headers hold only if every location has them:
 * one location added later without the include would serve that path bare, and nothing
 * but a request to it would show. The image itself is checked by
 * `scripts/docker-csp-smoke.sh` in CI.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { i18n, loadLanguage } from "@/shared/i18n";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const INCLUDE = "include /etc/nginx/kpubdata-security-headers.conf;";

/** Every `location … { … }` of the server, as `[what it matches, its body]`. */
function locations(conf: string): Array<[string, string]> {
  return [...conf.matchAll(/^\s*location\s+([^{]+?)\s*\{([^}]*)\}/gm)].map((match) => [match[1], match[2]]);
}

describe("docker/nginx.conf", () => {
  const conf = read("docker/nginx.conf");

  it("has the four kinds of response the checks below are about", () => {
    expect(locations(conf).map(([match]) => match)).toEqual(["/assets/", "= /config.js", "= /silent-check-sso.html", "/"]);
  });

  it.each(locations(conf))("sends the security headers from location %s", (_match, body) => {
    expect(body).toContain(INCLUDE);
    expect(body).toContain("add_header X-Content-Type-Options nosniff always;");
  });

  it("sets no header at the server, where a location's own would replace it", () => {
    const outside = conf.replace(/^\s*location\s+[^{]+\{[^}]*\}/gm, "");

    expect(outside).not.toMatch(/^\s*add_header\b/m);
    expect(outside).not.toContain("include /etc/nginx/kpubdata-security-headers.conf");
  });
});

describe("docker/security-headers.conf", () => {
  const headers = Object.fromEntries(
    [...read("docker/security-headers.conf").matchAll(/^add_header (\S+) "([^"]*)" always;$/gm)].map((match) => [match[1], match[2]]),
  );

  it("sends each header on every status, errors included", () => {
    // `always`: without it nginx leaves the header off a 404 or a 500.
    expect(Object.keys(headers).sort()).toEqual(["Permissions-Policy", "Referrer-Policy", "Strict-Transport-Security"]);
    expect(read("docker/security-headers.conf").match(/^add_header\b.*$/gm)).toHaveLength(3);
  });

  it("gives another site the origin and not the path", () => {
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("turns off the device features Studio does not use", () => {
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(headers["Permissions-Policy"]).toContain(`${feature}=()`);
    }
  });

  it("asks for HTTPS for a year, and does not speak for subdomains", () => {
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000");
  });

  it("is in the image where nginx.conf looks for it", () => {
    expect(read("Dockerfile")).toContain("COPY docker/security-headers.conf /etc/nginx/kpubdata-security-headers.conf");
  });
});

describe("the page's language", () => {
  afterEach(async () => {
    await i18n.changeLanguage("ko");
  });

  it("is Korean in index.html, the language Studio starts in", () => {
    expect(read("index.html")).toMatch(/<html lang="ko">/);
    expect(read("index.html")).not.toMatch(/<html lang="en"/);
  });

  it("follows the language the reader chooses", async () => {
    await loadLanguage("en");
    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");

    await i18n.changeLanguage("ko");
    expect(document.documentElement.lang).toBe("ko");
  });

  it("stays a language Studio has when asked for one it does not", async () => {
    await i18n.changeLanguage("fr");

    expect(document.documentElement.lang).toBe("ko");
  });
});
