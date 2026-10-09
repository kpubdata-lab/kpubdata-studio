/** Types for `ko-mixed-terms.mjs`, so its tests can import it (#843). */
export const KO_GLOSSARY: Map<string, string>;
export function flatten(tree: object, prefix?: string, out?: Map<string, string>): Map<string, string>;
export function mixedTerms(ko: object): Array<{ key: string; word: string; korean: string }>;
export function issueReferences(locales: Record<string, object>): Array<{ lang: string; key: string; ref: string }>;
