/**
 * Single-pass byte-size estimate for what `JSON.stringify(value)` would
 * produce, without allocating the intermediate string. Designed for the
 * Scout hot path: called per Play Cricket tool result (raw payloads up
 * to ~50 KB) on every chat turn.
 *
 * Semantics, vs. `JSON.stringify(value).length`:
 *
 *   Matches exactly:
 *     - null / boolean / number (incl. NaN/±Infinity → "null") / string
 *       length (UTF-16 code units, same as String.length)
 *     - object/array structural overhead: braces, brackets, commas, colons
 *     - object values that are undefined / function / symbol (omitted)
 *     - array elements that are undefined / function / symbol (encoded
 *       as "null", 4 bytes)
 *
 *   Approximates (under-counts):
 *     - String escape overhead — \", \\, \n, etc. each add 1 byte that
 *       we don't count. Cricket payloads are plain ASCII / numeric so
 *     this is a non-issue in practice.
 *
 *   Defensive divergences (we never throw; JSON.stringify might):
 *     - bigint → 0 bytes (JSON.stringify throws)
 *     - cyclic references → second visit counted as "null" (4 bytes);
 *       JSON.stringify throws TypeError. Telemetry must never break a
 *       chat turn, so we degrade gracefully.
 *
 * The 4-byte-per-cycle quirk also means the same object reachable via
 * two different paths (a DAG, not a cycle) is under-counted on the
 * second visit. Play Cricket responses don't share references — each
 * tool call produces a freshly parsed tree — so this is moot for the
 * payloads we measure. If that ever changes, swap WeakSet to Set with
 * add-on-enter / delete-on-exit.
 *
 * Recursive: relies on the V8 native stack. Play Cricket nests at most
 * ~6 deep; safe well below the default ~10k frame limit.
 */
export function approxJsonBytes(value: unknown): number {
  return walk(value, new WeakSet());
}

function walk(value: unknown, seen: WeakSet<object>): number {
  if (value === null || value === undefined) return 4; // "null"

  switch (typeof value) {
    case "boolean":
      return value ? 4 : 5; // "true" / "false"
    case "number":
      // JSON.stringify emits "null" for NaN, Infinity, -Infinity.
      return Number.isFinite(value) ? String(value).length : 4;
    case "string":
      // +2 for the surrounding quotes. We ignore per-char escape cost
      // (\\, \", \n, etc.) — see header for rationale.
      return value.length + 2;
    case "bigint":
    case "function":
    case "symbol":
      // JSON.stringify omits or throws; telemetry returns 0.
      return 0;
    case "object":
      break;
  }

  // From here, value is a non-null object or array.
  const obj = value as object;
  if (seen.has(obj)) return 4; // cycle / repeated DAG node
  seen.add(obj);

  if (Array.isArray(obj)) {
    const arr = obj as unknown[];
    let n = 2; // []
    const len = arr.length;
    for (let i = 0; i < len; i++) {
      if (i > 0) n += 1; // comma
      const v = arr[i];
      // Array holes / undefined / function / symbol → "null"
      if (v === undefined || typeof v === "function" || typeof v === "symbol") {
        n += 4;
      } else {
        n += walk(v, seen);
      }
    }
    return n;
  }

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record);
  let n = 2; // {}
  let written = 0;
  const klen = keys.length;
  for (let i = 0; i < klen; i++) {
    const key = keys[i];
    const v = record[key];
    // Match JSON.stringify: undefined / function / symbol values cause
    // the entire entry to be dropped.
    if (v === undefined || typeof v === "function" || typeof v === "symbol") {
      continue;
    }
    if (written > 0) n += 1; // comma between kept entries
    // "key": — quotes(2) + colon(1) + key chars (no escape accounting)
    n += key.length + 3;
    n += walk(v, seen);
    written++;
  }
  return n;
}
