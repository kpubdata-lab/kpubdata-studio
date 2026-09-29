/* global window */
// Runtime deployment settings (#411). The container image overwrites this file at
// start from its environment; see docker/40-kpubdata-config.sh. Left empty, Studio
// uses the values it was built with (VITE_*), which is what `npm run dev` and the
// GitHub Pages demo rely on.
window.__KPUBDATA_CONFIG__ = window.__KPUBDATA_CONFIG__ || {};
