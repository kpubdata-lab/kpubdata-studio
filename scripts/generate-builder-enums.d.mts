/** Types for `generate-builder-enums.mjs`, so its tests can import it (#793). */
export const OUTPUT: string;
export function collectEnums(document: unknown): Array<[string, unknown[]]>;
export function renderBuilderEnums(document: unknown): string;
export function main(args?: string[], output?: string): number;
