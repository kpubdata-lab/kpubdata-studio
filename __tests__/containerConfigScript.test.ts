/**
 * The container's start script writes what the page reads, and refuses what it
 * must not write (studio#411).
 *
 * `docker/40-kpubdata-config.sh` puts environment values inside a JavaScript file.
 * The image smoke test in docker.yml covers the image; this covers the script where
 * it can run without Docker, including the inputs it has to refuse.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RuntimeConfig } from "@/shared/config/runtime";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "docker", "40-kpubdata-config.sh");

let dir: string;
let out: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kpubdata-config-"));
  out = join(dir, "config.js");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(env: Record<string, string>): { code: number; stderr: string } {
  try {
    execFileSync("sh", [SCRIPT], {
      env: { PATH: process.env.PATH ?? "", KPUBDATA_CONFIG_OUT: out, KPUBDATA_CSP_OUT: join(dir, "csp.conf"), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stderr?: Buffer };
    return { code: e.status ?? 1, stderr: e.stderr?.toString() ?? "" };
  }
}

/** Evaluate config.js the way the browser does and return what lands on window. */
function loadWritten(): RuntimeConfig | undefined {
  const window: { __KPUBDATA_CONFIG__?: RuntimeConfig } = {};
  runInNewContext(readFileSync(out, "utf8"), { window });
  return window.__KPUBDATA_CONFIG__;
}

describe("docker/40-kpubdata-config.sh (#411)", () => {
  it("writes the deployment's settings where the page reads them", () => {
    const result = run({
      BUILDER_API_URL: "https://api.example.org:8443/v1?x=1&y=2",
      OIDC_ISSUER: "https://sso.example.org/realms/kpubdata",
      OIDC_CLIENT_ID: "kpubdata-studio",
    });
    expect(result.code).toBe(0);
    expect(loadWritten()).toEqual({
      builderApiUrl: "https://api.example.org:8443/v1?x=1&y=2",
      useRealBuilder: "true",
      oidcIssuer: "https://sso.example.org/realms/kpubdata",
      oidcClientId: "kpubdata-studio",
      privacyUrl: "",
      termsUrl: "",
      supportContact: "",
      accountUrl: "",
    });
  });

  it("writes the policy links and the support contact (#838)", () => {
    const result = run({
      PRIVACY_URL: "https://example.org/privacy",
      TERMS_URL: "https://example.org/terms",
      SUPPORT_CONTACT: "help@example.org",
      ACCOUNT_URL: "https://sso.example.org/realms/kpubdata/account",
    });
    expect(result.code).toBe(0);
    expect(loadWritten()).toMatchObject({
      privacyUrl: "https://example.org/privacy",
      termsUrl: "https://example.org/terms",
      supportContact: "help@example.org",
      accountUrl: "https://sso.example.org/realms/kpubdata/account",
    });
  });

  it.each([
    ["PRIVACY_URL", "ftp://example.org/privacy"],
    ["TERMS_URL", "example.org/terms"],
    ["ACCOUNT_URL", "javascript:void"],
    ["SUPPORT_CONTACT", "javascript:void"],
    ["SUPPORT_CONTACT", "http://example.org/support"],
  ])("refuses %s=%s and writes nothing (#838)", (name, value) => {
    const result = run({ [name]: value });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(name);
    expect(() => readFileSync(out)).toThrow();
  });

  it.each(["https://example.org/support", "mailto:help@example.org"])("keeps the contact %s (#838)", (value) => {
    expect(run({ SUPPORT_CONTACT: value }).code).toBe(0);
    expect(loadWritten()?.supportContact).toBe(value);
  });

  it("leaves every value to the build when nothing is set", () => {
    expect(run({}).code).toBe(0);
    expect(loadWritten()).toEqual({
      builderApiUrl: "",
      useRealBuilder: "",
      oidcIssuer: "",
      oidcClientId: "",
      privacyUrl: "",
      termsUrl: "",
      supportContact: "",
      accountUrl: "",
    });
  });

  it("keeps an explicit USE_REAL_BUILDER over the default", () => {
    run({ BUILDER_API_URL: "https://api.example.org", USE_REAL_BUILDER: "false" });
    expect(loadWritten()?.useRealBuilder).toBe("false");
  });

  it.each([
    ['a quote that would end the string', 'https://x"; alert(1); "'],
    ["a closing script tag", "https://x</script>"],
    ["a newline", "https://x\nwindow.y=1"],
    ["a backslash", "https://x\\"],
    ["a single quote", "https://x'"],
    ["a space", "https://x y"],
  ])("refuses %s and writes nothing", (_label, value) => {
    const result = run({ BUILDER_API_URL: value });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("BUILDER_API_URL");
    expect(() => readFileSync(out)).toThrow();
  });
});
