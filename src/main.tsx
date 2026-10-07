/**
 * Browser entry point for Vite-based KPubData Studio application.
 *
 * Locates root container in DOM, then mounts app using React 19 `createRoot` API.
 * Wraps entire app in `StrictMode` to check side effects more strictly during development.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { initAuth } from "@/features/auth/init";
import { i18nReady } from "@/shared/i18n"; // i18n initialization (side effect — before App)
import "./globals.css";

const faviconUrl = new URL("../assets/logo/kpubdata-brand-assets/svg/favicon.svg", import.meta.url).href;
const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement("link");
faviconLink.rel = "icon";
faviconLink.href = faviconUrl;
if (!faviconLink.parentNode) document.head.append(faviconLink);

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found");
}

initAuth();

// The language's resources arrive in their own chunk (#796): render once they are in, so
// the first paint is translated. i18nReady never rejects.
void i18nReady.then(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
