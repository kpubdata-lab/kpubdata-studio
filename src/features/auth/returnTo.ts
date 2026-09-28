/** Allow only internal Studio paths as login return location. */
export function getSafeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  // Backslash can also be interpreted as authority separator by URL parser.
  return new URL(value, window.location.origin).origin === window.location.origin ? value : "/";
}

/** Build current Studio URL including GitHub Pages basename. */
export function getStudioUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return new URL(`${base}${path.replace(/^\//, "")}`, window.location.origin).toString();
}
