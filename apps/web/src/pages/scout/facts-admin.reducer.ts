/**
 * State + reducers for the Scout fact corpus admin view.
 *
 * Two reducers, intentionally split because the state clusters serve
 * different roles:
 *
 *   1. `factsListReducer` — filters / search / pagination state for the
 *      list view (scope, q, tag). Drives the query key.
 *   2. `factEditReducer` — the edit-fact dialog form draft (content,
 *      scope, confidence, permanence, tagsText). Re-seeded from a Fact
 *      when a different fact is opened.
 *
 * Both are pure (no React) so they can be unit-tested without a renderer.
 *
 * The pending-delete fact is intentionally left as separate component
 * state — it's a single value, not a cluster of related fields.
 */

// Local mirror of the Permanence union shape so this file stays free of
// the generated OpenAPI types (which would pull a heavy import into pure
// reducer code). Keep this in sync with the API schema.
export type FactPermanence = "permanent" | "seasonal" | "ephemeral" | null;
export type FactScope = "user" | "club";

// --- list view (filters + search) -------------------------------------------

export interface FactsListState {
  scope: "" | FactScope;
  q: string;
  tag: string;
}

export const initialFactsListState: FactsListState = {
  scope: "",
  q: "",
  tag: "",
};

export type FactsListAction =
  | { type: "setScope"; value: "" | FactScope }
  | { type: "setQ"; value: string }
  | { type: "setTag"; value: string }
  | { type: "reset" };

export function factsListReducer(
  state: FactsListState,
  action: FactsListAction,
): FactsListState {
  switch (action.type) {
    case "setScope":
      return { ...state, scope: action.value };
    case "setQ":
      return { ...state, q: action.value };
    case "setTag":
      return { ...state, tag: action.value };
    case "reset":
      return initialFactsListState;
  }
}

/**
 * Convert the filter state into the API querystring (omit empty values
 * so the URL stays clean and the server doesn't see falsy filters).
 */
export function buildFactsListQuery(state: FactsListState): {
  scope?: FactScope;
  q?: string;
  tag?: string;
} {
  return {
    scope: state.scope === "" ? undefined : state.scope,
    q: state.q || undefined,
    tag: state.tag || undefined,
  };
}

// --- edit dialog (form draft) ----------------------------------------------

export interface FactEditFormState {
  content: string;
  scope: FactScope;
  confidence: number;
  permanence: FactPermanence;
  tagsText: string;
}

/**
 * Snapshot of a Fact's editable fields — only the bits this reducer
 * consumes when re-seeding the form. Keeps this file independent of
 * the generated OpenAPI types.
 */
export interface FactSeed {
  content: string;
  scope: FactScope;
  confidence: number;
  permanence: FactPermanence;
  tags: Record<string, string | string[]>;
}

export const initialFactEditFormState: FactEditFormState = {
  content: "",
  scope: "club",
  confidence: 3,
  permanence: null,
  tagsText: "{}",
};

export function makeFactEditFormState(
  fact: FactSeed | null | undefined,
): FactEditFormState {
  if (!fact) return initialFactEditFormState;
  return {
    content: fact.content,
    scope: fact.scope,
    confidence: fact.confidence,
    permanence: fact.permanence,
    tagsText: JSON.stringify(fact.tags),
  };
}

export type FactEditAction =
  | { type: "setContent"; value: string }
  | { type: "setScope"; value: FactScope }
  | { type: "setConfidence"; value: number }
  | { type: "setPermanence"; value: FactPermanence }
  | { type: "setTagsText"; value: string }
  | { type: "reseed"; fact: FactSeed | null };

export function factEditReducer(
  state: FactEditFormState,
  action: FactEditAction,
): FactEditFormState {
  switch (action.type) {
    case "setContent":
      return { ...state, content: action.value };
    case "setScope":
      return { ...state, scope: action.value };
    case "setConfidence":
      // Clamp to the valid 1–5 range so the UI can't slip an out-of-range
      // value through if the input misbehaves.
      return {
        ...state,
        confidence: Math.max(1, Math.min(5, action.value)),
      };
    case "setPermanence":
      return { ...state, permanence: action.value };
    case "setTagsText":
      return { ...state, tagsText: action.value };
    case "reseed":
      return makeFactEditFormState(action.fact);
  }
}

/**
 * Parse the tagsText JSON. Returns the parsed object or throws an Error
 * with a user-facing message — the component surfaces that message in
 * the dialog.
 */
export function parseTagsText(
  tagsText: string,
): Record<string, string | string[]> {
  try {
    // Trust + verify: cast then assume JSON.parse returned an object. The
    // server validates again on the wire, this is just a friendly preflight.
    return JSON.parse(tagsText) as Record<string, string | string[]>;
  } catch {
    throw new Error('Tags must be valid JSON, e.g. {"team":"Mitford CC"}');
  }
}

/**
 * Build the PATCH body. Only fields that differ from the original Fact
 * are included (so metadata-only edits skip the embedding round-trip).
 * `tags` is always included because parsing the string is itself an edit
 * (the user can change formatting without changing keys).
 */
export function buildFactEditPatch(
  state: FactEditFormState,
  original: FactSeed,
): {
  content?: string;
  scope?: FactScope;
  confidence?: number;
  permanence?: FactPermanence;
  tags: Record<string, string | string[]>;
} {
  const tags = parseTagsText(state.tagsText);
  return {
    content: state.content !== original.content ? state.content : undefined,
    scope: state.scope !== original.scope ? state.scope : undefined,
    confidence:
      state.confidence !== original.confidence ? state.confidence : undefined,
    permanence:
      state.permanence !== original.permanence ? state.permanence : undefined,
    tags,
  };
}
