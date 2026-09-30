/**
 * Korean locale values still in English (studio#588).
 *
 * #562 moved hard-coded English UI text into the locale files, but most of the new ko
 * values were the English text copied over, so the Korean screen kept showing
 * "Recent Runs", "Blockers" and "Status". The hard-coded text gate reads TSX, not the
 * locale files, and the key gate only checks that a key exists — nothing noticed.
 *
 * A ko value is reported when all three hold:
 *
 *   1. it has no Hangul,
 *   2. it is exactly the en value (a deliberate English ko value that differs from en,
 *      such as a shortened label, is a translation decision, not a copy), and
 *   3. what is left after removing `{{placeholders}}` reads as English prose, by the
 *      same `isEnglishProse` the hard-coded text gate uses — so formats, acronyms,
 *      Builder's status codes and the Bronze/Silver/Gold stage names pass.
 *
 * `KEPT_VALUES` lists the few whole values that stay English on purpose: the product
 * name "Ask KPubData" and similar. A value is listed, not a key, so a new key that
 * reuses one of these names needs no edit here, and any other English value does.
 */
import { isEnglishProse } from "./hardcoded-ui-text.mjs";

/** Whole ko values that are English on purpose — product names and formats. */
export const KEPT_VALUES = new Map([
  ["Ask KPubData", "product name of the AI entry (#531)"],
  ["Ask KPubData · BuildSpec", "product name and the BuildSpec format"],
  ["Ask KPubData: “{{query}}”", "product name, with the search text"],
  ["AI", "acronym badge next to Ask KPubData in search"],
  ["URL / REST API", "protocol names of a source kind"],
]);

const HANGUL = /[가-힣ㄱ-ㆎ]/;
const PLACEHOLDER = /\{\{[^}]*\}\}/g;

/** Flattens {a: {b: "x"}} to [["a.b", "x"]], keeping string leaves only. */
function leaves(tree, prefix = "") {
  if (typeof tree === "string") return [[prefix, tree]];
  if (tree && typeof tree === "object" && !Array.isArray(tree)) {
    return Object.entries(tree).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

/** Keys whose ko value is the en value left untranslated, as `[key, value]`, sorted by key. */
export function englishKoValues(ko, en) {
  const enValues = new Map(leaves(en));
  return leaves(ko)
    .filter(([key, value]) => {
      if (HANGUL.test(value)) return false;
      if (enValues.get(key) !== value) return false;
      if (KEPT_VALUES.has(value)) return false;
      return isEnglishProse(value.replace(PLACEHOLDER, " "));
    })
    .sort(([a], [b]) => a.localeCompare(b));
}
