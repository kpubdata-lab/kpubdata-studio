/**
 * A table's terms of use as its BuildSpec declares them (builder#764, ADR 0018).
 *
 * `license` is an SPDX identifier or `other`; with `other`, `license_name` names the licence
 * (`kogl-type-1`, `korea-public-data-unrestricted`) and `license_link` says where its terms
 * are written. `attribution` is the credit line every KOGL type requires.
 *
 * Studio only reads these fields: a field the BuildSpec does not declare stays null and is
 * shown as unknown, never filled in from the provider, the source or another run. A link is
 * only ever opened when it is an http(s) URL.
 */
import { parse as parseYaml } from "yaml";

export interface LicenceTerms {
  license: string | null;
  license_name: string | null;
  license_link: string | null;
  attribution: string | null;
}

/**
 * How the licence was declared: a standard SPDX identifier, a KOGL type under `other`,
 * another licence under `other`, or nothing at all.
 */
export type LicenceKind = "spdx" | "kogl" | "other" | "undeclared";

/** Thrown when a BuildSpec snapshot is not a YAML mapping. */
export class LicenceSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenceSpecError";
  }
}

function declared(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

/**
 * Reads the licence fields out of a BuildSpec's YAML text, as declared.
 *
 * @param text - The canonical BuildSpec YAML (`GET /builds/{run_id}/spec`).
 * @returns The four fields; each is null when the spec does not declare it as text.
 * @throws LicenceSpecError when the text is not a YAML mapping.
 */
export function licenceTermsFromSpecYaml(text: string): LicenceTerms {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (cause) {
    throw new LicenceSpecError(cause instanceof Error ? cause.message : String(cause));
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new LicenceSpecError("BuildSpec is not a mapping");
  }
  const spec = document as Record<string, unknown>;
  return {
    license: declared(spec.license),
    license_name: declared(spec.license_name),
    license_link: declared(spec.license_link),
    attribution: declared(spec.attribution),
  };
}

const KOGL = /^kogl(?:$|[-_\s])/i;

/**
 * Which kind of licence the terms declare. A KOGL type is recognised only by what is
 * declared — `license_name` under `other` (`kogl-type-1` … `kogl-type-4`), or a `license`
 * that itself names KOGL — never guessed from the provider.
 */
export function licenceKind(terms: LicenceTerms): LicenceKind {
  if (!terms.license) return "undeclared";
  if (KOGL.test(terms.license)) return "kogl";
  if (terms.license.toLowerCase() !== "other") return "spdx";
  return KOGL.test(terms.license_name ?? "") ? "kogl" : "other";
}

/**
 * Whether a licence link may be rendered as a link: an absolute http(s) URL only, as
 * `isSafePublishReference` decides for a publish reference. `javascript:`, `data:`, a
 * relative path or anything that does not parse stays text.
 */
export function isSafeLicenceLink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
