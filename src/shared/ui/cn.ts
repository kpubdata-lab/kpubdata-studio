/**
 * lightweight helper to conditionally compose Tailwind class strings.
 *
 * without external dependencies like clsx; falsy values (`undefined`/`false`/`""`)을 걸러내고 공백으로
 * 이어 붙인다. 공통 컴포넌트에서 variant별 클래스를 조립할 때 사용한다.
 */
export type ClassValue = string | false | null | undefined;

/**
 * joins truthy class values with spaces and returns the result.
 *
 * @param values - 합성할 클래스 값 목록(거짓값은 무시).
 * @returns 합쳐진 className 문자열.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
