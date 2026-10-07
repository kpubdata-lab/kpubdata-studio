import { describe, expect, it } from "vitest";

import { AmbiguousSpecError, specProviders } from "./providerKeys";
import { SPEC_PROVIDER_CASES } from "./specProviders.cases";

/** The one form the two parsers resolve differently; Studio refuses to guess (below). */
const REPEATED_MERGE_KEY = "two_merges_dup_key";

describe("specProviders reads a spec's providers as Builder's parser does (#788)", () => {
  it.each(SPEC_PROVIDER_CASES.filter((c) => c.name !== REPEATED_MERGE_KEY).map((c) => [c.name, c] as const))(
    "%s",
    (_name, { yaml, pyyaml }) => {
      // A document Builder refuses calls no provider, so it needs no key.
      expect(specProviders(yaml)).toEqual(pyyaml === "refused" ? [] : pyyaml);
    },
  );

  it("covers the forms that used to be read as naming no provider", () => {
    const byName = new Map(SPEC_PROVIDER_CASES.map((c) => [c.name, c.pyyaml]));
    for (const name of ["merge", "merge_list", "nested_alias", "dup_key_in_source", "dup_top_sources", "many_aliases"]) {
      expect(byName.get(name), name).toContain("datago");
    }
  });

  it("a merge that is overridden names only the provider the source ends up with", () => {
    for (const name of ["merge_overridden", "merge_after_explicit", "merge_list_first_wins", "dup_three"]) {
      const found = SPEC_PROVIDER_CASES.find((c) => c.name === name);
      expect(found && specProviders(found.yaml), name).toEqual(["datago"]);
    }
  });

  it("a mapping with two '<<' keys is refused, not guessed", () => {
    const found = SPEC_PROVIDER_CASES.find((c) => c.name === REPEATED_MERGE_KEY);
    // PyYAML lets the later merge win (datago); this library the earlier (seoul).
    expect(found?.pyyaml).toEqual(["datago"]);
    expect(() => specProviders(found?.yaml ?? "")).toThrow(AmbiguousSpecError);
  });

  it("two '<<' keys anywhere in the document are refused, also behind an anchor", () => {
    const spec = "a: &a {provider: seoul}\nc: &c {provider: datago}\nb: &b\n  <<: *a\n  <<: *c\nsources:\n  - <<: *b\n    dataset: d\n";
    expect(() => specProviders(spec)).toThrow(AmbiguousSpecError);
  });

  it("a quoted '<<' is an ordinary key, so two of them are only a repeated key", () => {
    const spec = 'sources:\n  - "<<": 1\n    "<<": 2\n    provider: datago\n';
    expect(specProviders(spec)).toEqual(["datago"]);
  });

  it("the error says nothing about the spec's contents", () => {
    const spec = "a: &a {provider: seoul, note: stand-in-private-text}\nsources:\n  - <<: *a\n    <<: *a\n";
    let message = "";
    try {
      specProviders(spec);
    } catch (cause) {
      message = String((cause as Error).message);
    }
    expect(message).toContain("<<");
    expect(message).not.toContain("stand-in-private-text");
    expect(message).not.toContain("seoul");
  });
});
