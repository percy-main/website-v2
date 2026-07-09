import type {
  ResolvedBlock,
  ResolvedEditOp,
  WriteContentBlock,
} from "@percy-main/shared/content";

// Applies agent-authored blocks/ops to the live BlockNote editor. Duck-typed
// against the slice of the editor API we use (method syntax keeps the real,
// schema-generic editor assignable) so tests run on a plain stub.

export interface EditorLike {
  document: Array<{ id: string }>;
  getBlock(blockId: string): unknown;
  insertBlocks(
    blocks: object[],
    referenceBlock: string | { id: string },
    placement: "before" | "after",
  ): unknown;
  updateBlock(blockId: string | { id: string }, update: object): unknown;
  removeBlocks(blockIds: Array<string | { id: string }>): unknown;
}

// Deep-clone via JSON (same pattern as editorBody) so agent blocks become
// plain PartialBlocks - strips prototypes/non-JSON values before BlockNote
// ingests them.
function clone<T>(value: T): T {
  // eslint-disable-next-line react-doctor/no-json-parse-stringify-clone -- deliberate JSON round-trip (same pattern as editorBody): strips non-JSON values so the blocks become plain PartialBlocks
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Append agent-authored blocks to the end of the draft (write_content). */
export function appendBlocks(
  editor: EditorLike,
  blocks: Array<WriteContentBlock | ResolvedBlock>,
): void {
  const doc = editor.document;
  if (doc.length === 0) return; // BlockNote documents always have >= 1 block
  editor.insertBlocks(clone(blocks), doc[doc.length - 1], "after");
}

/** Every existing-block id an op batch references (insert refs, update and
 *  delete targets). Ids of blocks the batch itself inserts are not included -
 *  the server guarantees in-batch ordering is valid. */
function referencedIds(ops: ResolvedEditOp[]): string[] {
  const ids: string[] = [];
  for (const op of ops) {
    if (op.op === "insert") {
      if (op.refBlockId) ids.push(op.refBlockId);
    } else if (op.op === "update") {
      ids.push(op.blockId);
    } else {
      ids.push(...op.blockIds);
    }
  }
  return ids;
}

export type ApplyEditOpsResult =
  { applied: true } | { applied: false; missingIds: string[] };

/**
 * Apply edit_content ops in stream order, all-or-nothing: if ANY referenced
 * block id no longer resolves (the user edited or restored a revision while
 * the agent was working), the WHOLE batch is dropped and reported, never
 * partially applied. The server validated the batch atomically against its
 * own mirror; applying half of it here could pair a skipped insert with a
 * destructive delete. The draft is the user's - their edits win.
 */
export function applyEditOps(
  editor: EditorLike,
  ops: ResolvedEditOp[],
): ApplyEditOpsResult {
  const missingIds = [
    ...new Set(referencedIds(ops).filter((id) => !editor.getBlock(id))),
  ];
  if (missingIds.length > 0) return { applied: false, missingIds };

  for (const op of ops) {
    if (op.op === "insert") {
      const doc = editor.document;
      if (op.at === "start" || op.at === "end") {
        // BlockNote documents always have >= 1 block to anchor on.
        if (doc.length === 0) continue;
        const reference = op.at === "start" ? doc[0] : doc[doc.length - 1];
        editor.insertBlocks(
          clone(op.blocks),
          reference,
          op.at === "start" ? "before" : "after",
        );
      } else if (op.refBlockId) {
        editor.insertBlocks(clone(op.blocks), op.refBlockId, op.at);
      }
    } else if (op.op === "update") {
      // PartialBlock semantics: provided fields replace, omitted fields keep
      // their current value (so an update without `content` retains the
      // block's existing formatted text).
      editor.updateBlock(op.blockId, clone(op.block));
    } else {
      editor.removeBlocks(op.blockIds);
    }
  }

  return { applied: true };
}
