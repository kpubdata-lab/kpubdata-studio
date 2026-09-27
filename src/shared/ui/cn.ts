/**
 * Lightweight helper to conditionally compose Tailwind class strings.
 *
 * Without external dependencies like clsx; filters falsy values (undefined/false/"")
 * and joins truthy values with spaces. Used in common components when assembling
 * variant-specific classes.
 */
export type ClassValue = string | false | null | undefined;

/**
 * Joins truthy class values with spaces and returns the result.
 *
 * @param values - Class values to compose (falsy values ignored).
 * @returns Combined className string.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
