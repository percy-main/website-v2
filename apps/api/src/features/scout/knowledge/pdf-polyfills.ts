/**
 * Side-effect-only module that installs the browser globals pdfjs-dist
 * 5.x expects (DOMMatrix, ImageData, Path2D) before pdfjs is imported.
 *
 * Imported as the first statement of pdf.ts so ESM's import hoisting
 * still gives us "polyfill before pdfjs" ordering. The polyfills come
 * from @napi-rs/canvas, which is already a dep (used by
 * @react-pdf/renderer for Scout report rendering).
 */

import {
  DOMMatrix as CanvasDOMMatrix,
  ImageData as CanvasImageData,
  Path2D as CanvasPath2D,
} from "@napi-rs/canvas";

const g = globalThis as Record<string, unknown>;
g.DOMMatrix ??= CanvasDOMMatrix;
g.ImageData ??= CanvasImageData;
g.Path2D ??= CanvasPath2D;
