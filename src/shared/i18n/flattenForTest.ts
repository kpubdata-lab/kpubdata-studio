/** Flatten locale JSON for testing — used for key set comparison. */
export function flattenForTest(resource: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown, prefix: string) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, prefix ? `${prefix}.${key}` : key);
      }
    } else {
      keys.add(prefix);
    }
  };
  walk(resource, "");
  return keys;
}
