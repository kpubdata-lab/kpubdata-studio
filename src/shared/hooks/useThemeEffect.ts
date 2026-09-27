/**
 * Effect hook that applies the saved theme mode to the actual DOM (#96).
 *
 * `useUIStore` stores theme value (`system | light | dark`) in localStorage, but there
 * was no code to reflect that value in the document. This hook updates the `<html>`
 * `data-theme` attribute to activate theme-specific CSS variables and Tailwind
 * `dark:` variants (`@custom-variant dark`) in `globals.css`.
 *
 * - `light` / `dark`: Set `data-theme` to the corresponding value.
 * - `system`: Remove the attribute to defer to `prefers-color-scheme`, and subscribe
 *   to media query changes to follow OS theme changes in real time.
 */
import { useEffect } from "react";
import { useUIStore } from "@/shared/hooks/useUIStore";

/** Reflects the selected theme mode in `<html data-theme>`. Removes the attribute if system mode. */
function applyTheme(theme: "system" | "light" | "dark"): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

/**
 * Applies the saved theme to the document and follows OS theme changes in system mode.
 *
 * Called once from the app root (duplicate calls are harmless but unnecessary).
 */
export function useThemeEffect(): void {
  const theme = useUIStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;

    // In system mode, subscribes to prefers-color-scheme to immediately reflect OS theme changes.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);
}
