/**
 * What Builder reads from a BuildSpec's YAML, case by case (#788).
 *
 * `pyyaml` is what PyYAML 6.0.3 `yaml.safe_load` — the call Builder parses a spec with —
 * gave for each document, run in kpubdata-builder's own environment on 2026-10-07:
 * `refused` when it raised, otherwise the string `sources[].provider` values it read
 * (lower-cased, in order, without repeats; a provider that is not a string is not one
 * Builder accepts and is left out). `specProviders.test.ts` holds Studio's reader to the
 * same answers. To add a case, run it through `yaml.safe_load` and write what came back —
 * do not write what this library says.
 */
export interface SpecProviderCase {
  name: string;
  yaml: string;
  pyyaml: "refused" | readonly string[];
}

export const SPEC_PROVIDER_CASES: readonly SpecProviderCase[] = [
  { name: "plain", yaml: "sources:\n  - provider: datago\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "dup_key_in_source", yaml: "sources:\n  - provider: seoul\n    dataset: a\n    provider: datago\n", pyyaml: ["datago"] },
  { name: "dup_top_sources", yaml: "sources:\n  - provider: seoul\n    dataset: a\nsources:\n  - provider: datago\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "merge", yaml: "base: &b\n  provider: datago\nsources:\n  - <<: *b\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "merge_list", yaml: "a: &a\n  provider: datago\nc: &c\n  dataset: x\nsources:\n  - <<: [*a, *c]\n", pyyaml: ["datago"] },
  { name: "merge_overridden", yaml: "base: &b\n  provider: seoul\nsources:\n  - <<: *b\n    provider: datago\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "alias_source", yaml: "one: &s\n  provider: datago\n  dataset: a\nsources:\n  - *s\n", pyyaml: ["datago"] },
  { name: "alias_scalar", yaml: "p: &p datago\nsources:\n  - provider: *p\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "nested_alias", yaml: "p: &p datago\nb: &b\n  provider: *p\nsources:\n  - <<: *b\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "upper", yaml: "sources:\n  - provider: DataGo\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "bool_like", yaml: "sources:\n  - provider: on\n    dataset: a\n", pyyaml: [] },
  { name: "number", yaml: "sources:\n  - provider: 123\n    dataset: a\n", pyyaml: [] },
  { name: "quoted_merge_key", yaml: "sources:\n  - \"<<\": {provider: datago}\n    dataset: a\n", pyyaml: [] },
  { name: "multi_doc", yaml: "sources:\n  - provider: seoul\n---\nsources:\n  - provider: datago\n", pyyaml: "refused" },
  { name: "unclosed", yaml: "sources: [unclosed", pyyaml: "refused" },
  { name: "tab_indent", yaml: "sources:\n\t- provider: datago\n", pyyaml: "refused" },
  { name: "flow", yaml: "sources: [{provider: datago, dataset: a}]\n", pyyaml: ["datago"] },
  { name: "anchor_undefined", yaml: "sources:\n  - provider: *nope\n", pyyaml: "refused" },
  { name: "tagged", yaml: "sources:\n  - provider: !!str datago\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "yaml11_octal", yaml: "sources:\n  - provider: 010\n    dataset: a\n", pyyaml: [] },
  { name: "key_case", yaml: "Sources:\n  - provider: datago\n", pyyaml: [] },
  { name: "null_provider", yaml: "sources:\n  - provider: ~\n    dataset: a\n", pyyaml: [] },
  { name: "recursive_alias", yaml: "a: &a\n  b: *a\nsources:\n  - provider: datago\n", pyyaml: ["datago"] },
  { name: "merge_after_explicit", yaml: "base: &b\n  provider: seoul\nsources:\n  - provider: datago\n    dataset: a\n    <<: *b\n", pyyaml: ["datago"] },
  { name: "merge_list_first_wins", yaml: "a: &a\n  provider: datago\nc: &c\n  provider: seoul\nsources:\n  - <<: [*a, *c]\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "two_merges_dup_key", yaml: "a: &a\n  provider: seoul\nc: &c\n  provider: datago\nsources:\n  - <<: *a\n    <<: *c\n    dataset: a\n", pyyaml: ["datago"] },
  { name: "dup_three", yaml: "sources:\n  - provider: seoul\n    provider: bok\n    provider: datago\n", pyyaml: ["datago"] },
  { name: "many_aliases", yaml: "p: &p datago\nsources:\n  - provider: *p\n    dataset: d0\n  - provider: *p\n    dataset: d1\n  - provider: *p\n    dataset: d2\n  - provider: *p\n    dataset: d3\n  - provider: *p\n    dataset: d4\n  - provider: *p\n    dataset: d5\n  - provider: *p\n    dataset: d6\n  - provider: *p\n    dataset: d7\n  - provider: *p\n    dataset: d8\n  - provider: *p\n    dataset: d9\n  - provider: *p\n    dataset: d10\n  - provider: *p\n    dataset: d11\n  - provider: *p\n    dataset: d12\n  - provider: *p\n    dataset: d13\n  - provider: *p\n    dataset: d14\n  - provider: *p\n    dataset: d15\n  - provider: *p\n    dataset: d16\n  - provider: *p\n    dataset: d17\n  - provider: *p\n    dataset: d18\n  - provider: *p\n    dataset: d19\n  - provider: *p\n    dataset: d20\n  - provider: *p\n    dataset: d21\n  - provider: *p\n    dataset: d22\n  - provider: *p\n    dataset: d23\n  - provider: *p\n    dataset: d24\n  - provider: *p\n    dataset: d25\n  - provider: *p\n    dataset: d26\n  - provider: *p\n    dataset: d27\n  - provider: *p\n    dataset: d28\n  - provider: *p\n    dataset: d29\n  - provider: *p\n    dataset: d30\n  - provider: *p\n    dataset: d31\n  - provider: *p\n    dataset: d32\n  - provider: *p\n    dataset: d33\n  - provider: *p\n    dataset: d34\n  - provider: *p\n    dataset: d35\n  - provider: *p\n    dataset: d36\n  - provider: *p\n    dataset: d37\n  - provider: *p\n    dataset: d38\n  - provider: *p\n    dataset: d39\n  - provider: *p\n    dataset: d40\n  - provider: *p\n    dataset: d41\n  - provider: *p\n    dataset: d42\n  - provider: *p\n    dataset: d43\n  - provider: *p\n    dataset: d44\n  - provider: *p\n    dataset: d45\n  - provider: *p\n    dataset: d46\n  - provider: *p\n    dataset: d47\n  - provider: *p\n    dataset: d48\n  - provider: *p\n    dataset: d49\n  - provider: *p\n    dataset: d50\n  - provider: *p\n    dataset: d51\n  - provider: *p\n    dataset: d52\n  - provider: *p\n    dataset: d53\n  - provider: *p\n    dataset: d54\n  - provider: *p\n    dataset: d55\n  - provider: *p\n    dataset: d56\n  - provider: *p\n    dataset: d57\n  - provider: *p\n    dataset: d58\n  - provider: *p\n    dataset: d59\n  - provider: *p\n    dataset: d60\n  - provider: *p\n    dataset: d61\n  - provider: *p\n    dataset: d62\n  - provider: *p\n    dataset: d63\n  - provider: *p\n    dataset: d64\n  - provider: *p\n    dataset: d65\n  - provider: *p\n    dataset: d66\n  - provider: *p\n    dataset: d67\n  - provider: *p\n    dataset: d68\n  - provider: *p\n    dataset: d69\n  - provider: *p\n    dataset: d70\n  - provider: *p\n    dataset: d71\n  - provider: *p\n    dataset: d72\n  - provider: *p\n    dataset: d73\n  - provider: *p\n    dataset: d74\n  - provider: *p\n    dataset: d75\n  - provider: *p\n    dataset: d76\n  - provider: *p\n    dataset: d77\n  - provider: *p\n    dataset: d78\n  - provider: *p\n    dataset: d79\n  - provider: *p\n    dataset: d80\n  - provider: *p\n    dataset: d81\n  - provider: *p\n    dataset: d82\n  - provider: *p\n    dataset: d83\n  - provider: *p\n    dataset: d84\n  - provider: *p\n    dataset: d85\n  - provider: *p\n    dataset: d86\n  - provider: *p\n    dataset: d87\n  - provider: *p\n    dataset: d88\n  - provider: *p\n    dataset: d89\n  - provider: *p\n    dataset: d90\n  - provider: *p\n    dataset: d91\n  - provider: *p\n    dataset: d92\n  - provider: *p\n    dataset: d93\n  - provider: *p\n    dataset: d94\n  - provider: *p\n    dataset: d95\n  - provider: *p\n    dataset: d96\n  - provider: *p\n    dataset: d97\n  - provider: *p\n    dataset: d98\n  - provider: *p\n    dataset: d99\n  - provider: *p\n    dataset: d100\n  - provider: *p\n    dataset: d101\n  - provider: *p\n    dataset: d102\n  - provider: *p\n    dataset: d103\n  - provider: *p\n    dataset: d104\n  - provider: *p\n    dataset: d105\n  - provider: *p\n    dataset: d106\n  - provider: *p\n    dataset: d107\n  - provider: *p\n    dataset: d108\n  - provider: *p\n    dataset: d109\n  - provider: *p\n    dataset: d110\n  - provider: *p\n    dataset: d111\n  - provider: *p\n    dataset: d112\n  - provider: *p\n    dataset: d113\n  - provider: *p\n    dataset: d114\n  - provider: *p\n    dataset: d115\n  - provider: *p\n    dataset: d116\n  - provider: *p\n    dataset: d117\n  - provider: *p\n    dataset: d118\n  - provider: *p\n    dataset: d119\n  - provider: *p\n    dataset: d120\n  - provider: *p\n    dataset: d121\n  - provider: *p\n    dataset: d122\n  - provider: *p\n    dataset: d123\n  - provider: *p\n    dataset: d124\n  - provider: *p\n    dataset: d125\n  - provider: *p\n    dataset: d126\n  - provider: *p\n    dataset: d127\n  - provider: *p\n    dataset: d128\n  - provider: *p\n    dataset: d129\n  - provider: *p\n    dataset: d130\n  - provider: *p\n    dataset: d131\n  - provider: *p\n    dataset: d132\n  - provider: *p\n    dataset: d133\n  - provider: *p\n    dataset: d134\n  - provider: *p\n    dataset: d135\n  - provider: *p\n    dataset: d136\n  - provider: *p\n    dataset: d137\n  - provider: *p\n    dataset: d138\n  - provider: *p\n    dataset: d139\n  - provider: *p\n    dataset: d140\n  - provider: *p\n    dataset: d141\n  - provider: *p\n    dataset: d142\n  - provider: *p\n    dataset: d143\n  - provider: *p\n    dataset: d144\n  - provider: *p\n    dataset: d145\n  - provider: *p\n    dataset: d146\n  - provider: *p\n    dataset: d147\n  - provider: *p\n    dataset: d148\n  - provider: *p\n    dataset: d149\n", pyyaml: ["datago"] },
  { name: "alias_fanout", yaml: "a: &a [x, x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]\nsources:\n  - provider: datago\n    note: *d\n", pyyaml: ["datago"] },
  { name: "yes_no", yaml: "sources:\n  - provider: no\n    dataset: a\n", pyyaml: [] },
  { name: "two_sources", yaml: "sources:\n  - provider: seoul\n    dataset: a\n  - provider: datago\n    dataset: b\n  - kind: file\n    upload_id: u\n", pyyaml: ["seoul", "datago"] },
  { name: "sources_mapping", yaml: "sources:\n  provider: datago\n", pyyaml: [] },
  { name: "empty", yaml: "", pyyaml: [] },
  { name: "scalar_doc", yaml: "just text", pyyaml: [] },
  { name: "merge_of_non_mapping", yaml: "sources:\n  - <<: 3\n    provider: datago\n", pyyaml: "refused" },
];
