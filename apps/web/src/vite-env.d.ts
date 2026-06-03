/// <reference types="vite/client" />

/**
 * vite-imagetools: `?imagetools` imports return a resolved URL string.
 */
declare module "*&imagetools" {
  const src: string;
  export default src;
}

/**
 * vite-imagetools: `?as=picture` imports return picture source metadata.
 */
declare module "*&as=picture" {
  const picture: import("@/components/optimised-image.js").PictureSource;
  export default picture;
}

declare module "*?as=picture" {
  const picture: import("@/components/optimised-image.js").PictureSource;
  export default picture;
}

/**
 * @fontsource-variable/* packages resolve to CSS files imported purely for
 * their side effects (font-face injection) and ship no type declarations.
 * Declared here so TS 6.0's noUncheckedSideEffectImports default is satisfied.
 */
declare module "@fontsource-variable/*";
