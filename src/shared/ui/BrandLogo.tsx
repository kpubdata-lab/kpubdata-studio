/**
 * The KPubData Studio logo for the current theme (Brand v2, #628).
 *
 * Light is the canonical brand, so the light asset is the default; the dark asset is
 * shown only under the dark theme. Both images are in the DOM and the `dark:` variant
 * (globals.css: an explicit `data-theme="dark"`, or the OS preference when none is set)
 * decides which is displayed, so a theme change needs no re-render. The dark copy has an
 * empty alt so the name is never announced twice.
 */
import { cn } from "./cn";

const ASSETS = {
  horizontal: {
    light: new URL("../../../assets/logo/kpubdata-brand-assets/svg/horizontal_light.svg", import.meta.url).href,
    dark: new URL("../../../assets/logo/kpubdata-brand-assets/svg/horizontal_dark.svg", import.meta.url).href,
  },
  symbol: {
    light: new URL("../../../assets/logo/kpubdata-brand-assets/svg/sidebar_light.svg", import.meta.url).href,
    dark: new URL("../../../assets/logo/kpubdata-brand-assets/svg/sidebar_dark.svg", import.meta.url).href,
  },
} as const;

export interface BrandLogoProps {
  /** The full lockup, or the symbol alone for narrow slots such as a collapsed sidebar. */
  variant?: keyof typeof ASSETS;
  /** Size classes applied to both images. */
  className?: string;
  /** Accessible name; empty when a surrounding element already names the link. */
  alt?: string;
}

/** Light logo by default, dark logo only under the dark theme. */
export function BrandLogo({ variant = "horizontal", className, alt = "KPubData Studio" }: BrandLogoProps) {
  const asset = ASSETS[variant];
  return (
    <>
      <img alt={alt} className={cn(className, "dark:hidden")} data-theme-variant="light" src={asset.light} />
      <img alt="" className={cn(className, "hidden dark:block")} data-theme-variant="dark" src={asset.dark} />
    </>
  );
}
