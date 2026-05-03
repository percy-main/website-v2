/**
 * Project a JSON value down to a set of dot-notation paths so we only feed
 * the agent the bytes it asked for. Cuts Play Cricket payloads (which can
 * be 5–10K tokens per match) by 80–95% in typical use, since the agent
 * almost never needs every batter row's balls/fours/sixes plus every
 * fall-of-wicket plus every player on both teams.
 *
 * Path syntax:
 *   - "foo"           → keep value[foo] (any type)
 *   - "foo.bar"       → keep value[foo][bar]
 *   - "foo[].bar"     → for each item of value[foo], keep item.bar
 *   - "foo[]"         → keep value[foo] (whole array, each element as-is)
 *
 * Multiple paths union into one result that mirrors the source structure.
 * Paths whose intermediate keys are missing are silently dropped (the model
 * may pass paths that don't exist in a particular response shape).
 */
export function project(value: unknown, fields: string[]): unknown {
  let result: unknown = undefined;
  for (const field of fields) {
    const segments = parsePath(field);
    result = mergePath(result, value, segments);
  }
  return result ?? null;
}

interface Segment {
  key: string;
  isArray: boolean;
}

function parsePath(path: string): Segment[] {
  return path.split(".").map((p) => {
    if (p.endsWith("[]")) return { key: p.slice(0, -2), isArray: true };
    return { key: p, isArray: false };
  });
}

function mergePath(
  acc: unknown,
  source: unknown,
  segments: Segment[],
): unknown {
  if (segments.length === 0) return source;
  if (source === null || source === undefined) return acc;

  const [seg, ...rest] = segments;
  if (typeof source !== "object") return acc;

  const sourceVal = (source as Record<string, unknown>)[seg.key];
  if (sourceVal === undefined) return acc;

  const accObj =
    typeof acc === "object" && acc !== null && !Array.isArray(acc)
      ? { ...(acc as Record<string, unknown>) }
      : ({} as Record<string, unknown>);

  if (seg.isArray) {
    if (!Array.isArray(sourceVal)) return acc;
    const sourceArr = sourceVal as unknown[];
    const existingArr = Array.isArray(accObj[seg.key])
      ? (accObj[seg.key] as unknown[])
      : [];
    accObj[seg.key] = sourceArr.map((item: unknown, i) => {
      if (rest.length === 0) return item;
      return mergePath(existingArr[i], item, rest);
    });
    return accObj;
  }

  accObj[seg.key] = mergePath(accObj[seg.key], sourceVal, rest);
  return accObj;
}
