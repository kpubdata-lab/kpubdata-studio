/**
 * display name of Builder `/catalog` provider code.
 *
 * NewBuildPage (#29) and Discover (#249) both render provider lists, so the
 * label mapping lives here once to avoid duplicated definitions.
 *
 * Wording lives in i18n under `provider.labels.*` (#350) — institution names
 * use the official English name. A constant map would freeze the language
 * at module load.
 */
import { i18n } from "@/shared/i18n";

export const PROVIDER_CODES = [
  "bok",
  "datago",
  "kosis",
  "krx",
  "law",
  "localdata",
  "lofin",
  "semas",
  "seoul",
  "sgis",
] as const;

/** show known provider codes in current language label, unknown codes as-is. */
export function providerLabel(provider: string): string {
  return (PROVIDER_CODES as readonly string[]).includes(provider)
    ? i18n.t(`provider.labels.${provider}`)
    : provider;
}
