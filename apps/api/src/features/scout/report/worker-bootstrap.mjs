// Dev-only worker bootstrap.
//
// tsx's auto-registering ESM loader (`--import tsx/esm`) checks isMainThread
// at the bottom of its module and skips registration in workers — so spawning
// a Worker with `execArgv: ["--import", "tsx/esm"]` runs the loader file but
// leaves no .ts/.tsx handler installed. The result: the worker imports
// pdf-document.tsx and Node's resolver throws "Unknown file extension".
//
// The fix: programmatically register tsx in this worker before importing any
// TypeScript file. tsx exposes a `register()` from `tsx/esm/api` that calls
// node:module.register() with its hooks. Plain ESM JS so this file itself
// loads without any prior registration.
//
// Production never references this file — render.ts in the prod build points
// the Worker straight at compiled `worker-entry.js`.
import { register } from "tsx/esm/api";

register();

await import("./worker-entry.ts");
