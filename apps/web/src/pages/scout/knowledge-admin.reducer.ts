/**
 * State + reducer + helpers for the Scout knowledge-base UploadForm.
 *
 * The UploadForm collected several primitive fields (file, title,
 * description, tagsRaw, error, busy) via independent useState calls,
 * which made the component large enough to trip react-doctor's
 * `prefer-useReducer` heuristic. Folding them into a single reducer
 * keeps the related fields co-located and lets us unit-test the
 * trickier piece — the comma-separated `key:value` tag parser — in
 * isolation.
 *
 * Pure functions only; no React or fetch imports so the file stays
 * easy to test under vitest.
 */

export interface UploadFormState {
  file: File | null;
  title: string;
  description: string;
  /** Comma-separated key:value pairs, e.g. `topic:rules, season:2026`. */
  tagsRaw: string;
  error: string | null;
  busy: boolean;
}

export const initialUploadFormState: UploadFormState = {
  file: null,
  title: "",
  description: "",
  tagsRaw: "",
  error: null,
  busy: false,
};

export type UploadFormAction =
  | { type: "setFile"; value: File | null }
  | { type: "setTitle"; value: string }
  | { type: "setDescription"; value: string }
  | { type: "setTagsRaw"; value: string }
  | { type: "setError"; value: string | null }
  | { type: "setBusy"; value: boolean }
  | { type: "reset" };

export function uploadFormReducer(
  state: UploadFormState,
  action: UploadFormAction,
): UploadFormState {
  switch (action.type) {
    case "setFile":
      return { ...state, file: action.value };
    case "setTitle":
      return { ...state, title: action.value };
    case "setDescription":
      return { ...state, description: action.value };
    case "setTagsRaw":
      return { ...state, tagsRaw: action.value };
    case "setError":
      return { ...state, error: action.value };
    case "setBusy":
      return { ...state, busy: action.value };
    case "reset":
      return initialUploadFormState;
  }
}

/**
 * Parse the comma-separated `key:value` tag input into the API's
 * `Record<string, string | string[]>` shape. Repeated keys collect
 * into an array. Whitespace is trimmed; entries without a colon, an
 * empty key, or an empty value are dropped silently — the admin gets
 * a single best-effort Tags input rather than per-pair validation.
 */
export function parseTags(raw: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || !value) continue;
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
}
