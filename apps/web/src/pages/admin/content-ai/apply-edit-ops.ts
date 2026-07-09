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

/**
 * Apply edit_content ops in stream order. Ops referencing blocks the user
 * has since deleted (or ids stale for any reason) are skipped rather than
 * thrown - the draft is the user's; the agent's view is best-effort.
 * Returns how many ops were skipped so the panel can surface it.
 */
export function applyEditOps(
  editor: EditorLike,
  ops: ResolvedEditOp[],
): { skipped: number } {
  let skipped = 0;

  for (const op of ops) {
    if (op.op === "insert") {
      const doc = editor.document;
      if (op.at === "start" || op.at === "end") {
        if (doc.length === 0) {
          skipped += 1;
          continue;
        }
        const reference = op.at === "start" ? doc[0] : doc[doc.length - 1];
        editor.insertBlocks(
          clone(op.blocks),
          reference,
          op.at === "start" ? "before" : "after",
        );
      } else {
        const reference = op.refBlockId ? editor.getBlock(op.refBlockId) : null;
        if (!reference || !op.refBlockId) {
          skipped += 1;
          continue;
        }
        editor.insertBlocks(clone(op.blocks), op.refBlockId, op.at);
      }
    } else if (op.op === "update") {
      if (!editor.getBlock(op.blockId)) {
        skipped += 1;
        continue;
      }
      // PartialBlock semantics: provided fields replace, omitted fields keep
      // their current value (so an update without `content` retains the
      // block's existing formatted text).
      editor.updateBlock(op.blockId, clone(op.block));
    } else {
      const existing = op.blockIds.filter((id) => Boolean(editor.getBlock(id)));
      if (existing.length < op.blockIds.length) {
        skipped += op.blockIds.length - existing.length;
      }
      if (existing.length > 0) {
        editor.removeBlocks(existing);
      }
    }
  }

  return { skipped };
}
