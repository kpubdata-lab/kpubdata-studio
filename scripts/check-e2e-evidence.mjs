/**
 * Refuse to publish e2e failure evidence that carries a credential (#726).
 *
 * The real-Builder e2e workflow uploads what a failed run leaves behind — Playwright
 * traces (which record every request and response, headers included), page snapshots
 * and the runner's log with Builder's output in it — so that a failure can be read
 * without re-running it. An artifact is downloadable by anyone who can read the
 * repository's Actions, so nothing goes up until this has read every text file in it:
 *
 *   - a JWT (a bearer token Studio holds after an OIDC sign-in);
 *   - an `Authorization: Bearer …` value;
 *   - an `X-Provider-Key` header value, or a provider key in a URL (`serviceKey=…`);
 *   - any literal value listed in `E2E_CANARY_SECRETS` (comma-separated). The workflow
 *     gives Builder a canary provider key and lists it here, so a key that leaks into
 *     a log, a manifest or a response is caught by value, whatever its shape.
 *
 * A value already redacted (`<redacted>`, `***`) passes. Image and video files are not
 * text and are skipped; a trace is a zip, so the workflow unpacks each one next to it
 * before running this. A finding prints the file and the kind of value, never the value.
 *
 * Usage:
 *   E2E_CANARY_SECRETS=a,b node scripts/check-e2e-evidence.mjs PATH...   # exit 1 on a finding
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BINARY = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".webm", ".mp4", ".zip", ".woff", ".woff2", ".ttf"]);

/** A value that has already been masked, in the forms Builder and Studio use. */
const REDACTED = String.raw`(?:<redacted>|%3Credacted%3E|\*{3,}|\[redacted\])`;

export const PATTERNS = [
  { name: "JWT", regex: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: "bearer token", regex: new RegExp(String.raw`\bBearer\s+(?!${REDACTED})[A-Za-z0-9._~+/=-]{16,}`, "i") },
  {
    name: "X-Provider-Key value",
    regex: new RegExp(String.raw`x-provider-key["']?\s*[:=]\s*["']?(?!${REDACTED})[^"'\s,}]{8,}`, "i"),
  },
  {
    // A trace records headers as HAR name/value pairs.
    name: "X-Provider-Key value",
    regex: new RegExp(String.raw`"name"\s*:\s*"x-provider-key"\s*,\s*"value"\s*:\s*"(?!${REDACTED})[^"]{8,}"`, "i"),
  },
  {
    name: "provider key in a URL",
    regex: new RegExp(String.raw`[?&](?:service_?key|api_?key|auth_?key|crtfc_key)=(?!${REDACTED})[^&\s"'<]{8,}`, "i"),
  },
];

/** Parse `E2E_CANARY_SECRETS`; values shorter than 8 characters would match by accident. */
export function canaries(raw) {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length >= 8);
}

/** Every finding in `text`, as the kinds of value found. */
export function scanText(text, secrets = []) {
  const found = PATTERNS.filter(({ regex }) => regex.test(text)).map(({ name }) => name);
  if (secrets.some((secret) => text.includes(secret))) found.push("canary secret");
  return found;
}

function walk(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => walk(join(path, name)));
}

/** Every finding under `paths`, as `{ path, kinds }`. A missing path is skipped. */
export function scan(paths, secrets = []) {
  const findings = [];
  for (const path of paths.filter((p) => existsSync(p)).flatMap(walk)) {
    if (BINARY.has(extname(path).toLowerCase())) continue;
    const kinds = scanText(readFileSync(path, "utf8"), secrets);
    if (kinds.length > 0) findings.push({ path, kinds });
  }
  return findings;
}

export function main(argv, env = process.env) {
  if (argv.length === 0) {
    console.error("usage: node scripts/check-e2e-evidence.mjs PATH...");
    return 2;
  }
  const findings = scan(argv, canaries(env.E2E_CANARY_SECRETS));
  for (const { path, kinds } of findings) console.error(`${path}: ${kinds.join(", ")}`);
  if (findings.length > 0) {
    console.error(`\n${findings.length} file(s) carry a credential; the evidence is not uploaded.`);
    return 1;
  }
  console.log(`no credential found under ${argv.join(", ")}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
