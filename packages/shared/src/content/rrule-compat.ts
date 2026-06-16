import * as rruleNs from "rrule";

// rrule ships no "exports" map in its package.json, so module resolvers
// disagree: bundlers (Vite) load its ESM build, which has named exports and
// NO default, while Node loads its CJS build, whose members are reachable
// only through the interop `default`. A plain `import rrule from "rrule"`
// therefore link-errors in the browser, and `import { RRule }` fails under
// raw Node ESM. Resolve both at runtime by preferring the named export and
// falling back to the interop default.
const lib =
  (rruleNs as typeof rruleNs & { default?: typeof rruleNs }).default ?? rruleNs;

export const RRule = lib.RRule;
export const rrulestr = lib.rrulestr;
export type { Options, Weekday } from "rrule";
