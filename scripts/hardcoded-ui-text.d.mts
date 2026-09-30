/** Types for `hardcoded-ui-text.mjs`, so the gate's tests can import it (#531). */
export interface UiText {
  line: number;
  text: string;
}

export const SHOWN_PROPS: Set<string>;
export function isEnglishProse(text: string): boolean;
export function uiTexts(file: string, source: string): UiText[];
export function hardCodedEnglish(file: string, source: string): UiText[];
export function scanEnglish(srcRoot: string): string[];
export function scanUiTexts(srcRoot: string): Array<UiText & { file: string }>;
