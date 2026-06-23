import {
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
} from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import {
  contentBodySchema,
  type ContentBody,
} from "@percy-main/shared/content";

// A deliberately narrow editor for member-facing bios. It keeps only the
// default TEXT blocks: the media blocks (image/video/audio/file) are dropped
// because they bypass the consent + EXIF-strip pipeline, and NONE of the
// club widget blocks (person grids, league tables, game previews...) are
// included - a member should not be inserting those into their own bio. The
// big admin editor keeps its full schema untouched; this is a separate,
// smaller one.
const {
  image: _image,
  video: _video,
  audio: _audio,
  file: _file,
  ...textBlockSpecs
} = defaultBlockSpecs;

export const bioSchema = BlockNoteSchema.create({ blockSpecs: textBlockSpecs });
export type BioPartialBlock = typeof bioSchema.PartialBlock;

const EDITABLE_BLOCK_TYPES = new Set(Object.keys(textBlockSpecs));

/**
 * True iff every block (recursively) is one this narrowed editor understands.
 * A bio that already contains an advanced block (a club widget, an inline
 * image) would lose that block if round-tripped through this editor, so the
 * surface falls back to read-only for those rather than silently dropping
 * content.
 */
export function bioIsEditable(body: unknown): boolean {
  if (!Array.isArray(body)) return false;
  const ok = (blocks: unknown[]): boolean =>
    blocks.every((b) => {
      if (typeof b !== "object" || b === null) return false;
      const block = b as { type?: unknown; children?: unknown };
      if (
        typeof block.type !== "string" ||
        !EDITABLE_BLOCK_TYPES.has(block.type)
      ) {
        return false;
      }
      if (Array.isArray(block.children) && block.children.length > 0) {
        return ok(block.children);
      }
      return true;
    });
  return ok(body);
}

interface BioEditorProps {
  initialContent: BioPartialBlock[] | undefined;
  onChange: (body: ContentBody) => void;
}

export function BioEditor({ initialContent, onChange }: BioEditorProps) {
  const editor = useCreateBlockNote({ schema: bioSchema, initialContent });

  return (
    <div className="bg-background rounded-md border">
      <BlockNoteView
        editor={editor}
        slashMenu={false}
        onChange={() => {
          // Same serialise-then-validate path the admin editor uses, against
          // the full recursive shared schema.
          onChange(
            contentBodySchema.parse(
              JSON.parse(JSON.stringify(editor.document)),
            ),
          );
        }}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={(query) =>
            Promise.resolve(
              filterSuggestionItems(
                getDefaultReactSlashMenuItems(editor),
                query,
              ),
            )
          }
        />
      </BlockNoteView>
    </div>
  );
}
