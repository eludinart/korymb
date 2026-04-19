/**
 * Injectés au build / démarrage Vite (`vite.config` : define).
 */
// eslint-disable-next-line no-undef
export const FRONTEND_APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
// eslint-disable-next-line no-undef
export const FRONTEND_REVISION_AT =
  typeof __APP_REVISION_AT__ !== "undefined" ? __APP_REVISION_AT__ : "";
