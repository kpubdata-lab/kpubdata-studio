/**
 * No English UI text typed straight into a screen (#531).
 *
 * #421, #422, #424 and #485 renamed the product's words in the locale files, but a label
 * written directly in TSX never passes through them — `Data Passport`, a `Validation`
 * heading, the tab labels — so it kept the old words and stayed English on the Korean
 * screen. The same scan runs in CI as part of `npm run i18n:check`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { hardCodedEnglish, scanEnglish } from "../scripts/hardcoded-ui-text.mjs";

// stale-ui-ignore: the retired AI label this test checks is gone (#531).
const RETIRED_AI_LABEL = "Assistant";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("hard-coded English UI text gate (#531)", () => {
  it("no screen under src/ writes English UI text directly", () => {
    expect(scanEnglish(SRC)).toEqual([]);
  });

  describe("the check fails when it should", () => {
    const texts = (source: string) => hardCodedEnglish("f.tsx", source).map((hit) => hit.text);

    it("finds JSX text, a shown prop, a rendered literal and a label kept in a constant", () => {
      const source = [
        '<h3 className="text-sm">Data Passport</h3>',
        `<Card title="${RETIRED_AI_LABEL}" />`,
        '<input aria-label="Table detail tabs" />',
        '<p>{ok ? "Done" : "Ready"}</p>',
        'const TABS = [{ id: "overview", label: "Overview" }];',
      ].join("\n");
      expect(texts(source)).toEqual(["Data Passport", RETIRED_AI_LABEL, "Table detail tabs", "Done", "Ready", "Overview"]);
    });

    it("finds English in a template literal, reading each substitution as a space", () => {
      const source = ["<Card sub={`Run ${id}`} />", "<p>{`${n} columns`}</p>"].join("\n");
      expect(texts(source)).toEqual(["Run", "columns"]);
    });

    it("an i18n-ignore marker on a code line exempts only that line", () => {
      const source = ['<input placeholder="gpt-4o-mini" /> {/* i18n-ignore */}', "<h3>Data Passport</h3>"].join("\n");
      expect(texts(source)).toEqual(["Data Passport"]);
    });

    it("leaves code, brand, formats, Builder's codes and marked sample values alone", () => {
      const source = [
        '<p>{t("home.title")}</p>',
        '<img alt="KPubData Studio" />',
        '<code>SELECT * FROM dataset</code>',
        "<span>PASS · WARN · FAIL</span>",
        '<option>CSV</option><option>JSON Lines</option>',
        '<input placeholder="https://api.example.org/data" />',
        '<input placeholder="owner/dataset" />',
        "<span>Bronze → Silver → Gold</span>",
        "// i18n-ignore: an example value, not a label",
        '<input placeholder="gpt-4o-mini" />',
        'const cls = "text-sm font-semibold";',
        "<div className={`rounded border ${active ? \"bg-accent\" : \"bg-card\"}`} />",
        "<p>{`${provider}.${dataset}`}</p>",
      ].join("\n");
      expect(texts(source)).toEqual([]);
    });
  });
});
