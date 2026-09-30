#!/usr/bin/env node
/**
 * Render the brand PNGs from their SVG sources (#425).
 *
 * The PNGs are derived files: change an SVG, run this, commit both. Rendering goes
 * through headless Chromium (Playwright, already a dev dependency) so no image tool is
 * needed. Backgrounds stay transparent except the social preview, which GitHub shows on
 * its own surface.
 *
 * Usage: node scripts/render-brand-png.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = join(ROOT, "assets/logo/kpubdata-brand-assets/svg");
const PNG = join(ROOT, "assets/logo/kpubdata-brand-assets/png");

/** [svg, png, width, height, padding] — the lockups are fitted inside with padding. */
const LOCKUPS = [
  ["horizontal_light.svg", "kpubdata-horizontal-light.png", 1400, 524, 0.12],
  ["horizontal_dark.svg", "kpubdata-horizontal-dark.png", 1400, 524, 0.12],
  ["vertical_light.svg", "kpubdata-vertical-light.png", 1024, 1024, 0.18],
  ["vertical_dark.svg", "kpubdata-vertical-dark.png", 1024, 1024, 0.18],
];

function page(svg, width, height, padding, background = "transparent", extra = "") {
  return `<!doctype html><html><head><style>
    html,body{margin:0;width:${width}px;height:${height}px;background:${background};}
    .frame{box-sizing:border-box;width:100%;height:100%;padding:${Math.round(Math.min(width, height) * padding)}px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;}
    .frame svg{max-width:100%;max-height:100%;width:auto;height:auto;flex:1 1 auto;min-height:0;}
    ${extra}
  </style></head><body><div class="frame">${svg}</div></body></html>`;
}

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });
const tab = await context.newPage();

for (const [source, target, width, height, padding] of LOCKUPS) {
  await tab.setViewportSize({ width, height });
  await tab.setContent(page(readFileSync(join(SVG, source), "utf8"), width, height, padding));
  await tab.screenshot({ path: join(PNG, target), omitBackground: true });
  console.log(`wrote png/${target}`);
}

// GitHub social preview: 1280×640 on the dark UI surface, lockup plus the product line.
const social = page(
  `<div class="lockup">${readFileSync(join(SVG, "horizontal_dark.svg"), "utf8")}</div>
   <p>한국 공공데이터를 수집하고, 출처와 이용 조건을 유지한 스냅샷으로 관리하며, 표와 SQL 로 분석하는 작업공간</p>`,
  1280,
  640,
  0.14,
  "#0F172A",
  `.lockup{width:760px;display:flex;justify-content:center}.lockup svg{width:100%;height:auto}
   p{margin:0;max-width:980px;text-align:center;word-break:keep-all;color:#CBD5E1;font:500 30px/1.45 "Pretendard","Noto Sans CJK KR","Noto Sans KR",sans-serif;}`,
);
await tab.setViewportSize({ width: 1280, height: 640 });
await tab.setContent(social);
await tab.screenshot({ path: join(ROOT, "assets/logo/social/github-social-preview.png") });
console.log("wrote social/github-social-preview.png");

await browser.close();
