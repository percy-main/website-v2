import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { useEffect, useState } from "react";
import { markdownToBlocks } from "./markdown";
import { SAMPLE_MARKDOWN } from "./sample";
import { type Editor, type PartialBlock, schema } from "./schema";

function insertPersonItem(editor: Editor) {
  return {
    title: "Person card",
    subtext: "Embed a club member profile card",
    group: "Club content",
    aliases: ["person", "player", "profile"],
    icon: <span aria-hidden>👤</span>,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: "person" });
    },
  };
}

export function App() {
  // Editor JSON is the canonical format (ADR 047). No markdown is derived;
  // the sample loads through the one-time migration path once, then the
  // document round-trips as JSON only.
  const [json, setJson] = useState("");

  const editor = useCreateBlockNote({
    schema,
    // Object URL stands in for the future S3 upload pipeline.
    uploadFile: async (file) => URL.createObjectURL(file),
  });

  useEffect(() => {
    void markdownToBlocks(editor, SAMPLE_MARKDOWN).then((blocks) => {
      editor.replaceBlocks(editor.document, blocks);
      setJson(JSON.stringify(editor.document, null, 2));
    });
  }, [editor]);

  return (
    <div className="min-h-screen bg-stone-100 p-4">
      <header className="mx-auto mb-4 max-w-6xl">
        <h1 className="text-xl font-bold text-stone-900">
          Editor spike: BlockNote
        </h1>
        <p className="text-sm text-stone-600">
          Issue #484 - rich text, person card block, image placeholder, JSON
          canonical (ADR 047). Type / for the block menu.
        </p>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg bg-white py-4">
          <BlockNoteView
            editor={editor}
            theme="light"
            slashMenu={false}
            onChange={() => {
              setJson(JSON.stringify(editor.document, null, 2));
            }}
          >
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) =>
                filterSuggestionItems(
                  [
                    insertPersonItem(editor),
                    ...getDefaultReactSlashMenuItems(editor),
                  ],
                  query,
                )
              }
            />
          </BlockNoteView>
        </section>

        <section className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2 rounded-t-lg border-b border-stone-200 bg-stone-50 p-2">
            <span className="text-sm font-semibold text-stone-700">
              JSON (canonical)
            </span>
            <button
              type="button"
              className="min-h-9 rounded border border-stone-300 bg-white px-2 text-sm"
              onClick={() =>
                editor.replaceBlocks(
                  editor.document,
                  JSON.parse(json) as PartialBlock[],
                )
              }
            >
              Apply to editor
            </button>
          </div>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            className="min-h-64 flex-1 rounded-b-lg bg-stone-900 p-4 font-mono text-sm text-stone-100"
          />
        </section>
      </main>
    </div>
  );
}
