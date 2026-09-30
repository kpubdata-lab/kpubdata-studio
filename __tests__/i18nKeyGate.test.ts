/**
 * The i18n key gate has to actually fail (studio#448).
 *
 * The bug that prompted the gate — `t("layout.homeLink")` against a locale file that
 * spells it `layout.studioHome` — was caught by one test that happened to assert on
 * that one aria-label. The gate has to catch the case where no such test exists, so it
 * is tested the only way that proves anything: by breaking something on purpose.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { englishKoValues } from "../scripts/ko-english-values.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "scripts", "check-i18n-keys.mjs");

let root: string;

function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync("node", [SCRIPT, "--root", root], {
      cwd: join(HERE, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function writeSource(body: string): void {
  writeFileSync(join(root, "src/app/Thing.tsx"), body, "utf8");
}

function writeLocales(ko: object, en: object): void {
  const dir = join(root, "src/shared/i18n/locales");
  writeFileSync(join(dir, "ko.json"), JSON.stringify(ko), "utf8");
  writeFileSync(join(dir, "en.json"), JSON.stringify(en), "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "i18n-gate-"));
  mkdirSync(join(root, "src/app"), { recursive: true });
  mkdirSync(join(root, "src/shared/i18n/locales"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the i18n key gate", () => {
  it("passes when every key resolves in both languages", () => {
    writeSource(`export const A = () => t("layout.studioHome");`);
    writeLocales({ layout: { studioHome: "홈" } }, { layout: { studioHome: "Home" } });

    const { code } = runGate();

    expect(code).toBe(0);
  });

  it("fails on the studio#360 bug — a key the locale files do not have", () => {
    writeSource(`export const A = () => t("layout.homeLink");`);
    writeLocales({ layout: { studioHome: "홈" } }, { layout: { studioHome: "Home" } });

    const { code, out } = runGate();

    expect(code).toBe(1);
    expect(out).toContain("layout.homeLink");
  });

  it("names the language that is missing the key, not just that one is", () => {
    writeSource(`export const A = () => t("layout.studioHome");`);
    writeLocales({ layout: { studioHome: "홈" } }, {});

    const { code, out } = runGate();

    expect(code).toBe(1);
    expect(out).toContain("missing from en");
  });

  it("reads a key through a file-local `t` wrapper instead of reporting its suffix", () => {
    writeSource(
      `const t = (key: string) => i18n.t(\`reports.export.\${key}\`);\n` +
        `export const A = () => t("detailHeading");`,
    );
    writeLocales(
      { reports: { export: { detailHeading: "상세" } } },
      { reports: { export: { detailHeading: "Detail" } } },
    );

    const { code } = runGate();

    expect(code).toBe(0);
  });

  it("still fails through a wrapper — the prefix must not become a way to pass", () => {
    writeSource(
      `const t = (key: string) => i18n.t(\`reports.export.\${key}\`);\n` +
        `export const A = () => t("gone");`,
    );
    writeLocales(
      { reports: { export: { detailHeading: "상세" } } },
      { reports: { export: { detailHeading: "Detail" } } },
    );

    const { code, out } = runGate();

    expect(code).toBe(1);
    expect(out).toContain("reports.export.gone");
  });

  it("fails when a computed key's whole group is gone", () => {
    writeSource("export const A = (s: string) => t(`status.${s}`);");
    writeLocales({ state: { ok: "정상" } }, { state: { ok: "OK" } });

    const { code, out } = runGate();

    expect(code).toBe(1);
    expect(out).toContain('key prefix "status"');
  });

  it("fails when ko and en hold different key sets", () => {
    writeSource("export const A = () => null;");
    writeLocales({ layout: { studioHome: "홈", extra: "여분" } }, { layout: { studioHome: "Home" } });

    const { code, out } = runGate();

    expect(code).toBe(1);
    expect(out).toContain("layout.extra");
  });

  it("reports a file whose `t` wrapper it cannot read, rather than skipping it", () => {
    writeSource(`const t = makeTranslator();\nexport const A = () => t("anything");`);
    writeLocales({ layout: { studioHome: "홈" } }, { layout: { studioHome: "Home" } });

    const { code, out } = runGate();

    expect(code).toBe(1);
    expect(out).toContain("could not be read");
  });
});

/*
 * Untranslated ko values (studio#588): #562 left 88 new ko values as the English text
 * they were copied from, and no gate read the locale values. The check has to fail on
 * the real locale files the moment one of them goes back to English.
 */
describe("the i18n key gate — ko values left in English (#588)", () => {
  const LOCALES = join(HERE, "..", "src", "shared", "i18n", "locales");
  const realKo = JSON.parse(readFileSync(join(LOCALES, "ko.json"), "utf8")) as Record<string, Record<string, string>>;
  const realEn = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf8")) as Record<string, Record<string, string>>;

  it("finds none in the real locale files", () => {
    expect(englishKoValues(realKo, realEn)).toEqual([]);
  });

  it("fails on the real locale files when one ko value is reverted to its English", () => {
    const reverted = structuredClone(realKo);
    reverted.labels.status = realEn.labels.status;

    expect(englishKoValues(reverted, realEn)).toEqual([["labels.status", "Status"]]);
  });

  it("fails the gate run and names the key", () => {
    writeSource(`export const A = () => t("tableDetail.run.recentRuns");`);
    writeLocales(
      { tableDetail: { run: { recentRuns: "Recent Runs" } } },
      { tableDetail: { run: { recentRuns: "Recent Runs" } } },
    );

    const { code, out } = runGate();

    expect(code).toBe(1);
    expect(out).toContain('"tableDetail.run.recentRuns" is English in ko.json');
  });

  it("reads through placeholders — `{{count}} rows` is still English", () => {
    expect(englishKoValues({ rows: "{{count}} rows" }, { rows: "{{count}} rows" })).toEqual([["rows", "{{count}} rows"]]);
  });

  it("passes product names, formats, codes and values that differ from en", () => {
    const values = {
      ask: "Ask KPubData",
      format: "CSV · JSON · SQL",
      codes: "PASS / WARN / FAIL",
      stages: "Bronze → Silver → Gold",
      id: "ID: {{id}}",
      mixed: "BuildSpec 스냅샷",
      shortened: "Runs",
    };
    const en = { ...values, shortened: "Recent runs" };

    expect(englishKoValues(values, en)).toEqual([]);
  });
});
