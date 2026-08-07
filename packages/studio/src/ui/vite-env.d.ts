/// <reference types="vite/client" />

/**
 * Fontsource packages resolve to a bare CSS entry, which `vite/client`'s
 * `*.css` glob can't match (no extension on the specifier). Declared here so
 * the side-effect imports in main.tsx typecheck.
 */
declare module "@fontsource-variable/geist";
declare module "@fontsource-variable/geist-mono";
