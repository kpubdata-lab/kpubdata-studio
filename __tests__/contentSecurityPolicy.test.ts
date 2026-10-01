/**
 * The Content-Security-Policy is delivered everywhere Studio is served, and stays one
 * policy (#663).
 *
 * - The policy itself: scripts and styles from Studio only, no eval, no plugins, no
 *   `<base>` elsewhere.
 * - `vite build` puts it in `index.html` as a meta element; the container build turns
 *   that off because nginx sends it as a header.
 * - `docker/40-kpubdata-config.sh` writes that header with the deployment's Builder and
 *   OIDC origins added, and is otherwise the same policy as the meta (the shell cannot
 *   import the TypeScript, so this test is what keeps the copies equal).
 * - `silent-check-sso.html`'s inline script is allowed by a hash in nginx.conf that has
 *   to match the file.
 * - No component renders a `<style>` element, which `style-src 'self'` blocks.
 *
 * `e2e/csp.spec.ts` runs the built app under the meta policy in a browser.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CSP_DIRECTIVES, contentSecurityPolicy } from "@/shared/config/contentSecurityPolicy";
import { contentSecurityPolicyMeta } from "../vite.csp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name, sources]),
  );
}

describe("the policy", () => {
  const policy = directives(contentSecurityPolicy());

  it("allows only Studio's own scripts and styles, with no inline code or eval", () => {
    expect(policy.get("script-src")).toEqual(["'self'"]);
    expect(policy.get("style-src")).toEqual(["'self'"]);
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(contentSecurityPolicy({ header: true })).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic/);
    for (const [name, sources] of policy) expect(sources, name).not.toContain("*");
  });

  it("blocks plugins and foreign base URLs", () => {
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
  });

  it("lets the page reach a runtime Builder, an OIDC issuer and a BYOK LLM over HTTPS, and a local Builder over HTTP", () => {
    expect(policy.get("connect-src")).toEqual(["'self'", "https:", "http://localhost:*", "http://127.0.0.1:*"]);
    expect(policy.get("frame-src")).toEqual(["'self'", "https:", "http://localhost:*", "http://127.0.0.1:*"]);
  });

  it("adds frame-ancestors only to the header, since a meta element cannot carry it", () => {
    expect(policy.has("frame-ancestors")).toBe(false);
    expect(directives(contentSecurityPolicy({ header: true })).get("frame-ancestors")).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES.some(([name]) => name === "frame-ancestors")).toBe(false);
  });
});

describe("vite build meta", () => {
  afterEach(() => vi.unstubAllEnvs());

  const transform = () => {
    const plugin = contentSecurityPolicyMeta();
    return (plugin.transformIndexHtml as () => unknown)();
  };

  it("is injected first in <head> on build only", () => {
    expect(contentSecurityPolicyMeta().apply).toBe("build");
    expect(transform()).toEqual([
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy() },
        injectTo: "head-prepend",
      },
    ]);
  });

  it("is left out of the container build, which sends a header instead", () => {
    vi.stubEnv("KPUBDATA_CSP_META", "off");
    expect(transform()).toEqual([]);
    expect(read("Dockerfile")).toMatch(/^RUN KPUBDATA_CSP_META=off npx vite build --base \/$/m);
  });
});

describe("container header", () => {
  const SCRIPT = join(ROOT, "docker", "40-kpubdata-config.sh");
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kpubdata-csp-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(env: Record<string, string>): { code: number; stderr: string; header?: string } {
    const cspOut = join(dir, "csp.conf");
    try {
      execFileSync("sh", [SCRIPT], {
        env: { PATH: process.env.PATH ?? "", KPUBDATA_CONFIG_OUT: join(dir, "config.js"), KPUBDATA_CSP_OUT: cspOut, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const e = error as { status?: number; stderr?: Buffer };
      return { code: e.status ?? 1, stderr: e.stderr?.toString() ?? "" };
    }
    const conf = readFileSync(cspOut, "utf8");
    const match = /^add_header Content-Security-Policy "([^"]+)" always;$/m.exec(conf);
    return { code: 0, stderr: "", header: match?.[1] };
  }

  it("is the meta policy plus frame-ancestors when no origin is configured", () => {
    const result = run({});
    expect(result.code).toBe(0);
    expect(result.header).toBe(contentSecurityPolicy({ header: true }));
  });

  it("adds the Builder and OIDC origins, so an HTTP Builder on another host still works", () => {
    const result = run({
      BUILDER_API_URL: "http://builder.internal:8000/api/v1?x=1",
      OIDC_ISSUER: "https://user@sso.example.org/realms/kpubdata",
    });
    expect(result.code).toBe(0);
    const header = directives(result.header!);
    const base = directives(contentSecurityPolicy({ header: true }));
    expect(header.get("connect-src")).toEqual([...base.get("connect-src")!, "http://builder.internal:8000", "https://sso.example.org"]);
    expect(header.get("frame-src")).toEqual([...base.get("frame-src")!, "https://sso.example.org"]);
    for (const [name, sources] of base) {
      if (name !== "connect-src" && name !== "frame-src") expect(header.get(name), name).toEqual(sources);
    }
  });

  it.each([
    ["a directive separator in the host", "https://a;script-src"],
    ["a scheme other than http(s)", "ftp://files.example.org"],
    ["no scheme", "builder.example.org"],
  ])("refuses %s rather than write it into the header", (_label, value) => {
    const result = run({ BUILDER_API_URL: value });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("BUILDER_API_URL");
  });

  it("is sent with the app's page, and the image lets the start script write it", () => {
    const nginx = read("docker/nginx.conf");
    const root = /location \/ \{([^}]*)\}/.exec(nginx)?.[1] ?? "";
    expect(root).toContain("include /etc/nginx/kpubdata-csp.conf;");
    expect(read("Dockerfile")).toContain("chown 101:101 /etc/nginx/kpubdata-csp.conf");
  });

  it("allows silent-check-sso.html's inline script by a hash that matches the file", () => {
    const html = read("public/silent-check-sso.html");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    const hash = createHash("sha256").update(scripts[0]).digest("base64");
    const block = /location = \/silent-check-sso\.html \{([^}]*)\}/.exec(read("docker/nginx.conf"))?.[1] ?? "";
    expect(block).toContain(`script-src 'sha256-${hash}'`);
    expect(block).toContain("default-src 'none'");
  });
});

describe("no inline <style> element", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
    });
  }

  it("is rendered by any component, since style-src 'self' would block it", () => {
    const offenders = sources(join(ROOT, "src")).filter((file) => /<style[\s>]/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
