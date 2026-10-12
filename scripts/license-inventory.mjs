#!/usr/bin/env node
/** Record locked npm packages and tracked artwork without making a legal finding. */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
const inventoryPath = join(root, "docs/compliance/license_inventory.json");
const noticePath = join(root, "public/THIRD_PARTY_NOTICES.md");
const assetExtensions = /\.(?:png|jpe?g|gif|svg|ico|woff2?|ttf|otf)$/i;
const plainDeclarations = /^(?:MIT|MIT-0|ISC|0BSD|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|CC0-1\.0)$/;

export const assets = [
  {
    id: "brand-artwork",
    paths: ["assets/logo/kpubdata-brand-assets/*", "assets/logo/social/*"],
    distributed: "source archive; selected SVGs in browser bundle",
    origin: "KPubData Brand v2; wordmark paths based on Pretendard (brand assets README)",
    terms: "Pretendard declares SIL OFL 1.1; treatment of outlined paths needs review",
    source: "https://github.com/orioncactus/pretendard/blob/main/LICENSE",
    status: "needs review",
  },
  {
    id: "product-screenshots",
    paths: ["assets/screenshots/*"],
    distributed: "repository only",
    origin: "captured from this project's UI",
    terms: "screen content and any provider data shown need review",
    source: "assets/screenshots/",
    status: "needs review",
  },
  {
    id: "documentation-brand-copies",
    paths: ["docs/brand/assets/*"],
    distributed: "repository documentation",
    origin: "copies of this project's brand artwork",
    terms: "same Pretendard-derived wordmark review as brand artwork",
    source: "assets/logo/kpubdata-brand-assets/README.md",
    status: "needs review",
  },
  {
    id: "prototype-screenshots",
    paths: ["docs/prototype/warehouse/screens/*"],
    distributed: "repository documentation",
    origin: "captured from this project's prototype",
    terms: "review any third-party data visible in the screenshots",
    source: "docs/prototype/warehouse/",
    status: "needs review",
  },
  {
    id: "visual-test-baselines",
    paths: ["e2e/visual.spec.ts-snapshots/*"],
    distributed: "test source only",
    origin: "generated from this project's UI in Playwright",
    terms: "same rights as displayed assets and data",
    source: "e2e/visual.spec.ts",
    status: "needs review",
  },
  {
    id: "public-template-icons",
    paths: ["public/file.svg", "public/globe.svg", "public/window.svg"],
    distributed: "browser static files and Docker image",
    origin: "source of original template icons is not documented",
    terms: "needs provenance and license review, even if the UI does not link to them",
    source: "public/",
    status: "needs review",
  },
  {
    id: "legacy-favicon",
    paths: ["src/app/favicon.ico"],
    distributed: "repository; current page uses the Brand v2 SVG",
    origin: "generated from Brand v2 artwork (brand assets README)",
    terms: "same Pretendard-derived wordmark review as brand artwork",
    source: "assets/logo/kpubdata-brand-assets/README.md",
    status: "needs review",
  },
];

export const containerInputs = [
  {
    name: "Node build stage",
    reference: "node:25-alpine",
    source: "https://github.com/nodejs/docker-node",
    terms: "build stage only; exact Alpine package versions unverified",
    status: "needs review",
  },
  {
    name: "nginx runtime base",
    reference: "nginxinc/nginx-unprivileged:1.31-alpine",
    source: "https://github.com/nginx/docker-nginx-unprivileged",
    terms: "runtime image; exact packages after apk upgrade unverified",
    status: "needs review",
  },
];

export function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n");
}

function matches(path, pattern) {
  return pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
}

export function packagesFromLock(lock) {
  return Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([path]) => path.includes("node_modules/"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, entry]) => {
        const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
        const license = typeof entry.license === "string" ? entry.license : "";
        return [path, {
          name,
          version: entry.version ?? "",
          scope: entry.dev ? "development install" : entry.optional ? "optional install" : "production install",
          license,
          source: entry.resolved ?? `https://www.npmjs.com/package/${encodeURIComponent(name)}`,
          status: plainDeclarations.test(license) ? "declared" : "needs review",
        }];
      }),
  );
}

function escapeCell(value) {
  return String(value).replaceAll("|", "/").replaceAll("\n", " ");
}

export function render(inventory) {
  const lines = [
    "# Third-party notices",
    "",
    "<!-- Generated by scripts/license-inventory.mjs. Do not edit. -->",
    "",
    "Studio's MIT `LICENSE` covers project code. npm packages and third-party artwork",
    "retain their own terms. This inventory records declarations; it does not clear",
    "copyright, attribution, source distribution, or font obligations.",
    "",
    "The npm lock is the complete install input, including development tools. A",
    "`production install` entry may or may not survive Vite tree shaking. The exact",
    "browser bundle and the patched container package set still need artifact review.",
    "The deployed site serves this notice at `/THIRD_PARTY_NOTICES.md`.",
    "",
    "## Items needing maintainer review",
    "",
  ];
  const review = Object.values(inventory.packages).filter((pkg) => pkg.status === "needs review");
  lines.push(...(review.length ? review.map((pkg) => `- npm \`${pkg.name}\` ${pkg.version}: \`${pkg.license || "(none)"}\``) : ["- No npm declaration gaps recorded."]));
  lines.push("- Pretendard-derived wordmark outlines and the public template icons need provenance and distribution review.");
  lines.push("- The exact built browser bundle and upgraded Alpine image contents are not inventoried yet.");
  lines.push("", "## Locked npm packages", "");
  lines.push("| Package | Version | Install scope | Declared license | Status | Source |", "| --- | --- | --- | --- | --- | --- |");
  for (const pkg of Object.values(inventory.packages)) {
    lines.push(`| ${escapeCell(pkg.name)} | ${escapeCell(pkg.version)} | ${pkg.scope} | ${escapeCell(pkg.license || "(none)")} | ${pkg.status} | ${escapeCell(pkg.source)} |`);
  }
  lines.push("", "## Tracked visual assets", "");
  lines.push("No font binary is tracked. The brand wordmark uses Pretendard outlines,", "described in the brand asset README; the upstream declaration is [SIL OFL 1.1](https://github.com/orioncactus/pretendard/blob/main/LICENSE).", "");
  lines.push("| Group | Paths | Distribution | Origin | Terms | Status |", "| --- | --- | --- | --- | --- | --- |");
  for (const asset of inventory.assets) {
    lines.push(`| ${asset.id} | \`${asset.paths.join("`, `")}\` | ${asset.distributed} | ${asset.origin} | ${asset.terms} | ${asset.status} |`);
  }
  lines.push("", "## Container inputs", "");
  lines.push("| Stage | Reference | Source | Gap | Status |", "| --- | --- | --- | --- | --- |");
  for (const input of inventory.containerInputs) {
    lines.push(`| ${input.name} | \`${input.reference}\` | ${input.source} | ${input.terms} | ${input.status} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function check(inventory, files = trackedFiles()) {
  if (!inventory) return [`${relative(root, inventoryPath)} is missing`];
  const problems = [];
  const expectedPackages = packagesFromLock(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")));
  if (JSON.stringify(inventory.packages) !== JSON.stringify(expectedPackages)) problems.push("npm lock entries differ from inventory");
  if (JSON.stringify(inventory.assets) !== JSON.stringify(assets)) problems.push("asset declarations differ from inventory");
  if (JSON.stringify(inventory.containerInputs) !== JSON.stringify(containerInputs)) problems.push("container inputs differ from inventory");
  for (const file of files.filter((path) => assetExtensions.test(path))) {
    if (!assets.some((asset) => asset.paths.some((pattern) => matches(file, pattern)))) problems.push(`visual asset is not covered: ${file}`);
  }
  for (const asset of assets) {
    if (!files.some((file) => asset.paths.some((pattern) => matches(file, pattern)))) problems.push(`asset declaration matches no file: ${asset.id}`);
  }
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  for (const token of ["node:25-alpine", "nginxinc/nginx-unprivileged:1.31-alpine", "apk upgrade --no-cache", "COPY --from=build /app/dist /usr/share/nginx/html"]) {
    if (!dockerfile.includes(token)) problems.push(`container reference changed: ${token}`);
  }
  if (!readFileSync(join(root, "index.html"), "utf8").includes("/src/main.tsx")) problems.push("browser entry changed; recheck bundled assets");
  try {
    if (readFileSync(noticePath, "utf8") !== render(inventory)) problems.push("THIRD_PARTY_NOTICES.md is stale");
  } catch {
    problems.push("THIRD_PARTY_NOTICES.md is missing");
  }
  return problems;
}

export function load() {
  try { return JSON.parse(readFileSync(inventoryPath, "utf8")); } catch { return null; }
}

function main() {
  if (process.argv.includes("--check-dist")) {
    try {
      if (readFileSync(join(root, "dist/THIRD_PARTY_NOTICES.md"), "utf8") !== readFileSync(noticePath, "utf8")) {
        console.error("license inventory: built notice differs from source");
        process.exitCode = 1;
      } else console.log("license inventory: built notice matches source");
    } catch {
      console.error("license inventory: built notice is missing");
      process.exitCode = 1;
    }
    return;
  }
  if (process.argv.includes("--check")) {
    const problems = check(load());
    if (problems.length) {
      for (const problem of problems) console.error(`license inventory: ${problem}`);
      process.exitCode = 1;
    } else console.log("license inventory: up to date");
    return;
  }
  const inventory = {
    packages: packagesFromLock(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))),
    assets,
    containerInputs,
  };
  mkdirSync(dirname(inventoryPath), { recursive: true });
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(noticePath, render(inventory));
  console.log(`wrote ${Object.keys(inventory.packages).length} locked packages`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
