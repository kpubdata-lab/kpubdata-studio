/**
 * capture-screenshots.mjs
 *
 * KPubData Studio 주요 화면을 Playwright/Chromium으로 자동 캡처하는 스크립트.
 *
 * 사용법:
 *   npm run screenshots
 *
 * 요구사항:
 *   - 브라우저 바이너리: npx playwright install chromium
 *   - 의존성: npm install
 *
 * 출력 위치: docs/assets/screenshots/
 * 캡처 해상도: 1280×800 (데스크톱 기준)
 * 테마: light / dark 각각 캡처
 */

import { chromium } from "playwright";
import { createServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "docs", "assets", "screenshots");

// build 하위 라우트는 데모 시드 데이터(src/shared/lib/demoDatasets.ts)의 실제 buildId를 사용한다.
const DEMO_SUCCEEDED = "air-quality-20260621"; // 대기오염 정보 (succeeded)
const DEMO_RUNNING = "dur-pregnancy-taboo-20260621"; // 임부금기 의약품 (running)

// 캡처할 주요 화면 목록
const SCREENS = [
  {
    id: "dashboard",
    route: "/",
    label: "대시보드 (Dashboard)",
  },
  {
    id: "builds",
    route: "/refresh-jobs",
    label: "빌드 목록 (Builds)",
  },
  {
    id: "new-build",
    route: "/refresh-jobs/new",
    label: "새 빌드 만들기 (New Build)",
  },
  {
    id: "build-detail",
    route: `/refresh-jobs/${DEMO_SUCCEEDED}`,
    label: "빌드 상세 (Build Detail)",
  },
  {
    id: "build-edit",
    route: `/refresh-jobs/${DEMO_SUCCEEDED}/edit`,
    label: "빌드 편집 (Build Edit)",
  },
  {
    id: "build-run",
    route: `/refresh-jobs/${DEMO_RUNNING}/run`,
    label: "빌드 실행 추적 (Build Run)",
  },
  {
    id: "build-artifacts",
    route: `/refresh-jobs/${DEMO_SUCCEEDED}/artifacts`,
    label: "빌드 결과물 (Build Artifacts)",
  },
  {
    id: "build-publish",
    route: `/refresh-jobs/${DEMO_SUCCEEDED}/publish`,
    label: "빌드 게시 (Build Publish)",
  },
  {
    id: "validate",
    route: "/validate",
    label: "검증 (Validate)",
  },
  {
    id: "preview",
    route: "/preview",
    label: "미리보기 (Preview)",
  },
  {
    id: "artifacts",
    route: "/artifacts",
    label: "결과물 (Artifacts)",
  },
  {
    id: "settings",
    route: "/settings",
    label: "설정 (Settings)",
  },
];

const THEMES = ["light", "dark"];
const VIEWPORT = { width: 1280, height: 800 };

async function main() {
  // 출력 디렉터리 준비
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Vite 개발 서버 시작 (MOCK 모드 강제)
  // 사용자 셸/CI에 VITE_USE_REAL_BUILDER=true 가 설정돼 있으면 Vite가 이를
  // 주입해 앱이 REAL 빌더 모드로 부팅된다. 스크린샷은 항상 오프라인/목 모드여야
  // 하므로, 스폰되는 Vite 서버 환경에서 이 값을 명시적으로 false로 강제한다.
  console.log("Vite 개발 서버를 시작합니다…");
  const server = await createServer({
    root: ROOT,
    define: {
      "import.meta.env.VITE_USE_REAL_BUILDER": JSON.stringify("false"),
    },
    server: { port: 5173 },
    // 빌드 오류가 화면에 overlay로 뜨지 않게 한다
    clearScreen: false,
  });
  await server.listen();
  const port = server.config.server.port ?? 5173;
  const base = `http://localhost:${port}`;
  console.log(`서버가 ${base} 에서 실행 중입니다.`);

  // Playwright Chromium 브라우저 실행
  console.log("Chromium 브라우저를 실행합니다…");
  const browser = await chromium.launch({ headless: true });

  try {
    for (const theme of THEMES) {
      console.log(`\n[테마: ${theme}]`);

      // 테마별 컨텍스트 생성
      const context = await browser.newContext({
        viewport: VIEWPORT,
        colorScheme: theme === "dark" ? "dark" : "light",
      });

      const page = await context.newPage();

      // 앱의 테마 상태를 localStorage로 미리 설정한다.
      // useUIStore(Zustand)가 localStorage "ui-store" 키를 사용하지 않으므로,
      // data-theme 속성을 HTML에 직접 주입하는 방식으로 테마를 강제한다.
      await page.addInitScript(
        /* eslint-disable no-undef */
        (t) => {
          // 초기 로드 시 data-theme을 한 번만 설정해 Tailwind dark: 변형이 적용되도록 한다.
          // readyState를 덮어쓰거나 자기 자신을 다시 트리거하는 MutationObserver는 쓰지 않는다.
          document.documentElement.dataset.theme = t;
        },
        /* eslint-enable no-undef */
        theme,
      );

      for (const screen of SCREENS) {
        const url = `${base}${screen.route}`;
        console.log(`  캡처 중: ${screen.label} → ${url}`);

        // Vite dev 서버는 HMR WebSocket이 계속 열려 있어 "networkidle"이 불안정하다.
        // domcontentloaded로 이동한 뒤 안정적인 selector(main)를 명시적으로 기다려
        // 렌더 완료를 보장한다.
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("main", { timeout: 15000 });

        // React Router가 렌더링을 마칠 시간을 준다
        await page.waitForTimeout(300);

        // 테마 data-theme 속성을 직접 설정해 Tailwind dark: 클래스를 활성화한다
        // eslint-disable-next-line no-undef
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);

        await page.waitForTimeout(100);

        const filename = `${screen.id}-${theme}.png`;
        const outputPath = path.join(OUTPUT_DIR, filename);
        await page.screenshot({ path: outputPath, fullPage: false });
        console.log(`    저장됨: docs/assets/screenshots/${filename}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
    console.log("\n완료! docs/assets/screenshots/ 에 PNG 파일이 생성되었습니다.");
  }
}

main().catch((error) => {
  console.error("캡처 중 오류가 발생했습니다:", error);
  process.exit(1);
});
