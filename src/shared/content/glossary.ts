/**
 * Glossary — provides explanation strings used by `TermHelp` tooltips throughout the UI.
 *
 * The strings themselves are in i18n under the `glossary.*` key (#350). This file
 * only declares **which terms exist** — if we stored strings as module constants,
 * language switching would not be reflected.
 */
import { i18n } from "@/shared/i18n";

export const GLOSSARY_TERMS = [
  "dataset",
  "build",
  "run",
  "buildSpec",
  "provider",
  "credential",
  "preview",
  "bronze",
  "silver",
  "gold",
  "quality",
  "schemaDrift",
  "evidence",
  "context",
  "generatedSql",
  "artifact",
  "manifest",
  "readiness",
] as const;

export type GlossaryKey = (typeof GLOSSARY_TERMS)[number];

/** Returns the explanation string for a term in the current language. */
export function glossaryDescription(term: GlossaryKey): string {
  return i18n.t(`glossary.${term}`);
}
