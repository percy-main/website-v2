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
