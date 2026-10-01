#!/usr/bin/env node
/**
 * Render the brand PNGs (and src/app/favicon.ico) from their SVG sources (#425, #628).
 *
 * The PNGs are derived files: change an SVG, run this, commit both. Rendering goes
 * through headless Chromium (Playwright, already a dev dependency) so no image tool is
 * needed. Backgrounds stay transparent except the app icon (white tile) and the social
 * preview, which GitHub shows on its own surface (Brand v2 Canvas, light-first).
 *
 * Usage: node scripts/render-brand-png.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
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

/** [svg, png, size] — square symbol renders, the SVG fills the whole image. */
const SYMBOLS = [
  ["symbol_light.svg", "kpubdata-symbol-light-512.png", 512],
  ["symbol_dark.svg", "kpubdata-symbol-dark-512.png", 512],
  ["favicon.svg", "favicon-32.png", 32],
  ["favicon.svg", "favicon-16.png", 16],
];

/** A PNG-in-ICO container (Windows Vista+, every current browser) from [size, png] pairs. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, png], i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(([, png]) => png)]);
}

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

const square = (svg, size, inner = size, background = "transparent") =>
  `<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;background:${background};}
    body{display:flex;align-items:center;justify-content:center}img{display:block;width:${inner}px;height:${inner}px}</style></head>
    <body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;

const icoImages = [];
for (const [source, target, size] of SYMBOLS) {
  await tab.setViewportSize({ width: size, height: size });
  await tab.setContent(square(readFileSync(join(SVG, source), "utf8"), size));
  await tab.screenshot({ path: join(PNG, target), omitBackground: true });
  console.log(`wrote png/${target}`);
}
for (const size of [16, 32, 48]) {
  await tab.setViewportSize({ width: size, height: size });
  await tab.setContent(square(readFileSync(join(SVG, "favicon.svg"), "utf8"), size));
  icoImages.push([size, await tab.screenshot({ omitBackground: true })]);
}
writeFileSync(join(ROOT, "src/app/favicon.ico"), ico(icoImages));
console.log("wrote src/app/favicon.ico (16, 32, 48)");

// App icon: the symbol on a white tile; the glyph covers 60% of the tile.
await tab.setViewportSize({ width: 1024, height: 1024 });
await tab.setContent(square(readFileSync(join(SVG, "symbol_light.svg"), "utf8"), 1024, 820, "#FFFFFF"));
await tab.screenshot({ path: join(PNG, "kpubdata-app-icon-1024.png") });
console.log("wrote png/kpubdata-app-icon-1024.png");

// GitHub social preview: 1280×640 on the Brand v2 Canvas, lockup plus the product line.
const social = page(
  `<div class="lockup">${readFileSync(join(SVG, "horizontal_light.svg"), "utf8")}</div>
   <p>한국 공공데이터를 수집하고, 출처와 이용 조건을 유지한 스냅샷으로 관리하며, 표와 SQL 로 분석하는 작업공간</p>`,
  1280,
  640,
  0.14,
  "#F7F8F3",
  `.lockup{width:760px;display:flex;justify-content:center}.lockup svg{width:100%;height:auto}
   p{margin:0;max-width:980px;text-align:center;word-break:keep-all;color:#64748B;font:500 30px/1.45 "Pretendard","Noto Sans CJK KR","Noto Sans KR",sans-serif;}`,
);
await tab.setViewportSize({ width: 1280, height: 640 });
await tab.setContent(social);
await tab.screenshot({ path: join(ROOT, "assets/logo/social/github-social-preview.png") });
console.log("wrote social/github-social-preview.png");

await browser.close();
