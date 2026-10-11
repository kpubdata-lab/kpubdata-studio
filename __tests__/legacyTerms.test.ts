/**
 * The old build-console screen names stay out of user strings (#423).
 *
 * The maintainer's decision of 2026-10-06 retired Discover, Add Data, Datasets, Builds,
 * Provider and their Korean forms: the names are removed, not kept beside the new ones.
 * These tests show the gate (`scripts/legacy-terms.mjs`) failing when one comes back,
 * leaving the words the product still uses alone, and passing on Studio's own locales.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALLOWED, LEGACY_TERMS, legacyTerms } from "../scripts/legacy-terms.mjs";
import { flatten } from "../scripts/ko-mixed-terms.mjs";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "scripts", "legacy-terms.mjs");

/** The retired names a tree holds, as `key:text`, with no exceptions in force. */
const names = (tree: object, lang = "en") =>
  legacyTerms({ [lang]: tree }, []).found.map(({ key, text }) => `${key}:${text}`);

describe("the retired-name detector", () => {
  it.each([
    ["Discover", "Use Discover to find data."],
    ["Add Data", "Go to Add Data"],
    ["Add data", "Add data"],
    ["Datasets", "Datasets"],
    ["dataset", "Open this dataset."],
    ["Build", "New Build"],
    ["Add Data", "Make it again in Add Data."],
    ["Builds", "Builds"],
    ["build", "The build failed."],
    ["rebuild", "Run it again to rebuild the files."],
    ["built", "Nothing has been built yet."],
    ["Kubi", "Ask Kubi"],
  ])("reports %s in an English string", (text, value) => {
    expect(names({ a: value })).toEqual([`a:${text}`]);
  });

  it.each([
    ["빌드", "빌드 스펙이 올바르지 않습니다."],
    ["데이터 추가", "데이터 추가에서 다시 만들어 주세요."],
    ["Add Data", "Add Data로 이동"],
    ["데이터셋", "이 데이터셋을 엽니다."],
    ["작업대", "작업대에 저장했습니다."],
    ["갱신 이력", "갱신 이력에서 다시 열 수 있습니다."],
    ["쿠비", "쿠비에게 묻기"],
    ["제공자 설정", "제공자 설정에서 연결하세요."],
  ])("reports %s in a Korean string", (text, value) => {
    expect(names({ a: value }, "ko")).toEqual([`a:${text}`]);
  });

  it("leaves the words the product still uses alone", () => {
    expect(
      names({
        format: "The BuildSpec is invalid.",
        product: "KPubData Builder writes the file.",
        qualified: "Pick a source dataset. Source Datasets are listed by provider.",
        verb: "The left menu takes you to data discovery.",
        institution: "Provider responded with an error",
      }),
    ).toEqual([]);
    expect(names({ qualified: "소스 데이터셋을 선택하세요.", institution: "제공자 정보를 불러올 수 없습니다" }, "ko")).toEqual([]);
  });

  it("does not read codes, paths, placeholders and tags", () => {
    expect(
      names({
        code: "CREATE_BUILD_DRAFT: provider is not in the catalog",
        path: "Builder GET /builds returns only completed history",
        dotted: "build.id is missing",
        field: "sources[0].dataset: no such value",
        placeholder: "{{build}} Snapshot Files",
        backticks: "`FROM dataset` reads the table.",
        tag: "<build>Open</build>",
      }),
    ).toEqual([]);
  });

  it("reports Provider only where it names a screen", () => {
    const found = legacyTerms(
      {
        en: {
          nav: { provider: "Provider" },
          assistant: { context: { page: { provider: "Providers" } } },
          labels: { provider: "Provider" },
          hint: "Change the key in the provider settings screen.",
          credential: "Register it under Provider / API connections.",
        },
      },
      [],
    ).found;

    expect(found.map(({ key, text }) => `${key}:${text}`)).toEqual([
      "nav.provider:Provider",
      "assistant.context.page.provider:Providers",
      "hint:provider settings",
      "credential:Provider / API",
    ]);
  });

  it("excuses one key in one language, and reports an exception that excuses nothing", () => {
    const allowed = [
      { lang: "ko", key: "nav.workspace", term: "작업대", reason: "glossary" },
      { lang: "ko", key: "nav.gone", term: "작업대", reason: "the value changed" },
    ];
    const { found, unused } = legacyTerms(
      { ko: { nav: { workspace: "작업대", gone: "화면" }, other: "작업대에 저장했습니다." }, en: { nav: { workspace: "작업대" } } },
      allowed,
    );

    expect(found.map(({ lang, key }) => `${lang} ${key}`)).toEqual(["ko other", "en nav.workspace"]);
    expect(unused).toEqual([allowed[1]]);
  });
});

describe("Studio's locales", () => {
  it("hold no retired name outside the exceptions, and every exception is in use", () => {
    expect(legacyTerms({ ko, en })).toEqual({ found: [], unused: [] });
  });

  it("fail the gate when any retired name is put back into a value", () => {
    // One sample per rule, written into a key no exception covers.
    const samples: Record<string, string> = {
      Discover: "Discover",
      "Add Data": "Add Data",
      "데이터 추가": "데이터 추가",
      Datasets: "Datasets",
      데이터셋: "데이터셋",
      build: "Builds",
      빌드: "빌드",
      Kubi: "Kubi",
      작업대: "작업대",
      "갱신 이력": "갱신 이력",
      "Provider (screen)": "Provider",
    };
    expect(Object.keys(samples).sort()).toEqual([...new Set(LEGACY_TERMS.map(({ term }) => term))].sort());

    for (const [term, text] of Object.entries(samples)) {
      for (const [lang, tree] of [["ko", ko], ["en", en]] as const) {
        const changed = structuredClone(tree);
        changed.nav.quality = text;
        const locales = lang === "ko" ? { ko: changed, en } : { ko, en: changed };
        expect(
          legacyTerms(locales).found.map(({ lang: at, key, term: name }) => `${at} ${key} ${name}`),
          `${lang}: ${text}`,
        ).toContain(`${lang} nav.quality ${term}`);
      }
    }
  });

  it("keep every exception pointed at a value that holds the name", () => {
    const values = { ko: flatten(ko), en: flatten(en) } as Record<string, Map<string, string>>;
    for (const { lang, key, reason } of ALLOWED) {
      expect(values[lang]?.has(key), `${lang} ${key}`).toBe(true);
      expect(reason.length, `${lang} ${key} needs a reason`).toBeGreaterThan(20);
    }
  });
});

describe("the CLI", () => {
  it("passes on these locales", () => {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf8" });

    expect(out).toContain("Retired screen names in user strings: 0 (baseline 0).");
    expect(out).toContain("unused: 0 (baseline 0).");
  });

  it("exits 1 when a retired name is back in a locale file", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-terms-"));
    try {
      const real = join(HERE, "..", "src", "shared", "i18n", "locales");
      const back = JSON.parse(readFileSync(join(real, "en.json"), "utf8")) as typeof en;
      back.nav.discover = "Discover";
      writeFileSync(join(dir, "en.json"), JSON.stringify(back));
      writeFileSync(join(dir, "ko.json"), readFileSync(join(real, "ko.json")));

      let status = 0;
      let out = "";
      try {
        execFileSync("node", [SCRIPT, "--locales", dir, "--github"], { encoding: "utf8", stdio: "pipe" });
      } catch (error) {
        const failed = error as { status?: number; stdout?: string };
        status = failed.status ?? -1;
        out = failed.stdout ?? "";
      }

      expect(status).toBe(1);
      expect(out).toContain('::error title=Retired screen name in a user string (#423)::en nav.discover: "Discover"');
      expect(out).toContain("Retired screen names in user strings: 1 (baseline 0).");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is run by CI and by `npm run i18n:legacy`", () => {
    const ci = readFileSync(join(HERE, "..", ".github", "workflows", "ci.yml"), "utf8");
    const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as { scripts: Record<string, string> };

    expect(ci).toContain("run: node scripts/legacy-terms.mjs --github");
    expect(pkg.scripts["i18n:legacy"]).toBe("node scripts/legacy-terms.mjs");
  });
});
