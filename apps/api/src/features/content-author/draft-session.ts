import {
  getBlockCatalogEntry,
  type DraftBlocks,
  type EditOp,
  type ResolvedBlock,
  type ResolvedEditOp,
  type WriteContentBody,
} from "@percy-main/shared/content";
import { randomUUID } from "node:crypto";

/**
 * Per-request model of the editor draft, shared by the write_content and
 * edit_content tools. Initialised from the editorContext.blocks snapshot the
 * client sends with the turn, then kept in step with every mutation the agent
 * makes, so tool calls can be validated server-side (unknown block ids,
 * rewrites of non-writable blocks) and inserted blocks can be assigned ids the
 * model can target in later calls. Only ids, types and nesting are tracked -
 * text content is irrelevant to validation.
 */
export interface DraftSession {
  /** Track appended blocks (write_content), assigning each a fresh id. */
  append(blocks: WriteContentBody): ResolvedBlock[];
  /**
   * Validate and apply edit ops. All-or-nothing: ops are simulated in order
   * on a working copy and committed only if every op succeeds, so a failed
   * call leaves no phantom ids behind and the client applies either the
   * whole batch or nothing.
   */
  apply(ops: EditOp[]): ApplyResult;
}

export type ApplyResult =
  | { ok: true; resolved: ResolvedEditOp[]; insertedBlockIds: string[] }
  | { ok: false; error: string };

interface DraftNode {
  id: string;
  type: string;
  children: DraftNode[];
}

function toNodes(blocks: DraftBlocks): DraftNode[] {
  return blocks.map((block) => ({
    id: block.id,
    type: block.type,
    children: block.children ? toNodes(block.children) : [],
  }));
}

function cloneNodes(nodes: DraftNode[]): DraftNode[] {
  return nodes.map((node) => ({
    ...node,
    children: cloneNodes(node.children),
  }));
}

/** Locate a block anywhere in the tree: its sibling array and index there. */
function locate(
  nodes: DraftNode[],
  id: string,
): { siblings: DraftNode[]; index: number } | null {
  for (let index = 0; index < nodes.length; index++) {
    if (nodes[index].id === id) return { siblings: nodes, index };
    const nested = locate(nodes[index].children, id);
    if (nested) return nested;
  }
  return null;
}

// Error strings are receipts the model reads - they must say how to recover.
function unknownIdError(id: string): string {
  return `Unknown block id "${id}". Target ids from the draft listing in your instructions, or ids returned by earlier write_content/edit_content receipts this turn.`;
}

export function createDraftSession(initial: DraftBlocks): DraftSession {
  let nodes = toNodes(initial);

  return {
    append(blocks) {
      const resolved = blocks.map((block) => ({
        ...block,
        id: randomUUID(),
      }));
      nodes.push(
        ...resolved.map((block) => ({
          id: block.id,
          type: block.type,
          children: [],
        })),
      );
      return resolved;
    },

    apply(ops) {
      const working = cloneNodes(nodes);
      const resolved: ResolvedEditOp[] = [];
      const insertedBlockIds: string[] = [];

      for (const op of ops) {
        if (op.op === "insert") {
          const fresh: ResolvedBlock[] = op.blocks.map((block) => ({
            ...block,
            id: randomUUID(),
          }));
          const freshNodes = fresh.map((block) => ({
            id: block.id,
            type: block.type,
            children: [],
          }));
          if (op.at === "start") {
            working.unshift(...freshNodes);
          } else if (op.at === "end") {
            working.push(...freshNodes);
          } else {
            const refBlockId = op.refBlockId;
            if (!refBlockId) {
              return {
                ok: false,
                error: `refBlockId is required when "at" is "${op.at}".`,
              };
            }
            const ref = locate(working, refBlockId);
            if (!ref) {
              return { ok: false, error: unknownIdError(refBlockId) };
            }
            ref.siblings.splice(
              op.at === "before" ? ref.index : ref.index + 1,
              0,
              ...freshNodes,
            );
          }
          insertedBlockIds.push(...fresh.map((block) => block.id));
          resolved.push({
            op: "insert",
            at: op.at,
            refBlockId: op.refBlockId,
            blocks: fresh,
          });
        } else if (op.op === "update") {
          const found = locate(working, op.blockId);
          if (!found) return { ok: false, error: unknownIdError(op.blockId) };
          const target = found.siblings[found.index];
          const entry = getBlockCatalogEntry(target.type);
          if (entry && !entry.agentWritable) {
            return {
              ok: false,
              error: `Block "${op.blockId}" is a ${target.type} block, which the assistant must not rewrite. You may delete it, but only if the user explicitly asked.`,
            };
          }
          target.type = op.block.type;
          resolved.push({ op: "update", blockId: op.blockId, block: op.block });
        } else {
          // Duplicate ids in one delete would make the second locate() fail
          // spuriously - dedupe rather than error.
          const ids = [...new Set(op.blockIds)];
          for (const id of ids) {
            const found = locate(working, id);
            if (!found) return { ok: false, error: unknownIdError(id) };
            // Splicing the node out drops its descendants with it.
            found.siblings.splice(found.index, 1);
          }
          resolved.push({ op: "delete", blockIds: ids });
        }
      }

      nodes = working;
      return { ok: true, resolved, insertedBlockIds };
    },
  };
}
