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
import { markdownToBlocks, toMarkdown } from "./markdown";
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
  // Editor JSON is the canonical format; markdown is derived one-way for
  // revision diffs / export. The markdown tab keeps the round-trip check
  // from the spike for comparison, but storage round-trips JSON only.
  const [view, setView] = useState<"json" | "markdown">("json");
  const [json, setJson] = useState("");
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN);
  const [roundTrip, setRoundTrip] = useState<"pass" | "fail" | null>(null);

  const editor = useCreateBlockNote({
    schema,
    // Object URL stands in for the future S3 upload pipeline.
    uploadFile: async (file) => URL.createObjectURL(file),
  });

  const syncPanels = () => {
    setJson(JSON.stringify(editor.document, null, 2));
    void toMarkdown(editor, editor.document).then(setMarkdown);
  };

  useEffect(() => {
    // One-time import: the legacy MDX reports arrive as markdown once,
    // then JSON is canonical from the first save.
    void markdownToBlocks(editor, SAMPLE_MARKDOWN).then((blocks) => {
      editor.replaceBlocks(editor.document, blocks);
      syncPanels();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [editor]);

  const applyMarkdown = async (md: string) => {
    const blocks = await markdownToBlocks(editor, md);
    editor.replaceBlocks(editor.document, blocks);
    return await toMarkdown(editor, editor.document);
  };

  const applyJson = (text: string) => {
    editor.replaceBlocks(editor.document, JSON.parse(text) as PartialBlock[]);
    syncPanels();
  };

  const checkRoundTrip = async () => {
    const before = await toMarkdown(editor, editor.document);
    const after = await applyMarkdown(before);
    setMarkdown(after);
    setRoundTrip(before === after ? "pass" : "fail");
    if (before !== after) {
      console.log("ROUND TRIP BEFORE:\n" + before);
      console.log("ROUND TRIP AFTER:\n" + after);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 p-4">
      <header className="mx-auto mb-4 max-w-6xl">
        <h1 className="text-xl font-bold text-stone-900">
          Editor spike: BlockNote
        </h1>
        <p className="text-sm text-stone-600">
          Issue #484 - rich text, ::person directive, image placeholder, JSON
          canonical + derived markdown. Type / for the block menu.
        </p>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg bg-white py-4">
          <BlockNoteView
            editor={editor}
            theme="light"
            slashMenu={false}
            onChange={() => {
              setRoundTrip(null);
              syncPanels();
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
            <button
              type="button"
              onClick={() => setView("json")}
              className={`min-h-9 rounded border px-2 text-sm font-medium ${
                view === "json"
                  ? "border-stone-700 bg-stone-700 text-white"
                  : "border-stone-300 bg-white text-stone-700"
              }`}
            >
              JSON (canonical)
            </button>
            <button
              type="button"
              onClick={() => setView("markdown")}
              className={`min-h-9 rounded border px-2 text-sm font-medium ${
                view === "markdown"
                  ? "border-stone-700 bg-stone-700 text-white"
                  : "border-stone-300 bg-white text-stone-700"
              }`}
            >
              Markdown (derived)
            </button>
            <button
              type="button"
              className="min-h-9 rounded border border-stone-300 bg-white px-2 text-sm"
              onClick={() =>
                view === "json" ? applyJson(json) : void applyMarkdown(markdown)
              }
            >
              Apply to editor
            </button>
            {view === "markdown" && (
              <>
                <button
                  type="button"
                  className="min-h-9 rounded border border-stone-300 bg-white px-2 text-sm"
                  onClick={() => void checkRoundTrip()}
                >
                  Round-trip check
                </button>
                {roundTrip && (
                  <span
                    className={`text-sm font-bold ${
                      roundTrip === "pass" ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {roundTrip === "pass"
                      ? "✓ lossless"
                      : "✗ lossy (see console)"}
                  </span>
                )}
              </>
            )}
          </div>
          <textarea
            value={view === "json" ? json : markdown}
            onChange={(e) =>
              view === "json"
                ? setJson(e.target.value)
                : setMarkdown(e.target.value)
            }
            spellCheck={false}
            className="min-h-64 flex-1 rounded-b-lg bg-stone-900 p-4 font-mono text-sm text-stone-100"
          />
        </section>
      </main>
    </div>
  );
}
