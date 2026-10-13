/**
 * nginx hides its version and compresses text on the way out (#994).
 *
 * The bundle budget (scripts/check-bundle-size.mjs) is measured gzipped, but nginx sent
 * every bundle at full size and named its version in the Server header and on its error
 * pages. These read the configuration; `scripts/docker-csp-smoke.sh` asks the running
 * image the same questions in CI.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = readFileSync(join(ROOT, "docker/nginx.conf"), "utf8");

/** The directives of the server block outside any location, as name -> arguments. */
function serverDirectives(): Map<string, string> {
  const server = conf.slice(conf.indexOf("server {"));
  const outside = server.replace(/^\s*location\s+[^{]+\{[^}]*\}/gm, "").replace(/#.*$/gm, "");
  return new Map([...outside.matchAll(/^\s*([a-z_]+)\s+([^;]*);/gm)].map((match) => [match[1], match[2].trim()]));
}

describe("docker/nginx.conf", () => {
  const directives = serverDirectives();
  const types = (directives.get("gzip_types") ?? "").split(/\s+/);

  it("does not name its version", () => {
    expect(directives.get("server_tokens")).toBe("off");
  });

  it("compresses text and says that the body depends on Accept-Encoding", () => {
    expect(directives.get("gzip")).toBe("on");
    expect(directives.get("gzip_vary")).toBe("on");
    expect(directives.get("gzip_proxied")).toBe("any");
  });

  it("compresses the bundle's text types", () => {
    // The base image's mime.types serves .js as application/javascript; text/javascript
    // is the type a later mime.types moves to.
    for (const type of ["application/javascript", "text/javascript", "text/css", "application/json", "image/svg+xml"]) {
      expect(types).toContain(type);
    }
  });

  it("does not compress what is compressed already", () => {
    for (const type of types) {
      expect(type).not.toMatch(/^(font\/woff2?|image\/(png|jpeg|gif|webp|avif)|application\/(zip|gzip|octet-stream))$/);
    }
    expect(types).not.toContain("*");
  });

  it("leaves the headers to the locations, where they are", () => {
    // gzip_vary adds Vary at the server; no add_header may join it there.
    expect([...directives.keys()]).not.toContain("add_header");
    expect([...directives.keys()]).not.toContain("include");
  });
});
