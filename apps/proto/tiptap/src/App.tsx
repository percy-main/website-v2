import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
import { Person } from "./extensions/person";
import { SAMPLE_MARKDOWN } from "./sample";

function ToolbarButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // prevent the editor losing selection when tapping toolbar buttons
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-h-9 rounded border px-2 text-sm font-medium ${
        active
          ? "border-stone-700 bg-stone-700 text-white"
          : "border-stone-300 bg-white text-stone-700"
      }`}
    >
      {label}
    </button>
  );
}

export function App() {
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN);
  const [roundTrip, setRoundTrip] = useState<"pass" | "fail" | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [StarterKit, Image, Person, Markdown],
    content: SAMPLE_MARKDOWN,
    contentType: "markdown",
    onUpdate: ({ editor }) => {
      setMarkdown(editor.getMarkdown());
      setRoundTrip(null);
    },
    editorProps: {
      attributes: {
        class: "tiptap rounded-b-lg bg-white p-4",
      },
      // Drag-dropped image files become object-URL placeholder images.
      // The real implementation will upload to S3 and use the final URL.
      handleDrop: (view, event) => {
        const file = event.dataTransfer?.files?.[0];
        if (!file?.type.startsWith("image/")) {
          return false;
        }
        event.preventDefault();
        const pos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          view.state.selection.from;
        const node = view.state.schema.nodes.image.create({
          src: URL.createObjectURL(file),
          alt: file.name,
        });
        view.dispatch(view.state.tr.insert(pos, node));
        return true;
      },
    },
  });

  if (!editor) {
    return null;
  }

  const insertImageFromPicker = (file: File) => {
    editor
      .chain()
      .focus()
      .setImage({ src: URL.createObjectURL(file), alt: file.name })
      .run();
  };

  const applyLink = () => {
    if (linkUrl) {
      editor.chain().focus().setLink({ href: linkUrl }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const checkRoundTrip = () => {
    const before = editor.getMarkdown();
    editor.commands.setContent(before, { contentType: "markdown" });
    const after = editor.getMarkdown();
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
          Editor spike: TipTap
        </h1>
        <p className="text-sm text-stone-600">
          Issue #484 - rich text, ::person directive, image placeholder,
          markdown round-trip
        </p>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-2">
        <section>
          <div className="sticky top-0 z-10 flex flex-wrap gap-1 rounded-t-lg border-b border-stone-200 bg-stone-50 p-2">
            <ToolbarButton
              label="B"
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <ToolbarButton
              label="I"
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToolbarButton
              label="H1"
              active={editor.isActive("heading", { level: 1 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
            />
            <ToolbarButton
              label="H2"
              active={editor.isActive("heading", { level: 2 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            />
            <ToolbarButton
              label="• List"
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            />
            <ToolbarButton
              label="1. List"
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            />
            <ToolbarButton
              label="Link"
              active={editor.isActive("link")}
              onClick={() => setShowLinkInput((v) => !v)}
            />
            <ToolbarButton
              label="Person"
              onClick={() =>
                editor.chain().focus().insertContent({ type: "person" }).run()
              }
            />
            <ToolbarButton
              label="Image"
              onClick={() => fileInputRef.current?.click()}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  insertImageFromPicker(file);
                }
                e.target.value = "";
              }}
            />
            {showLinkInput && (
              <div className="flex w-full gap-1 pt-1">
                <input
                  type="url"
                  placeholder="https://…"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyLink()}
                  className="min-h-9 flex-1 rounded border border-stone-300 bg-white px-2 text-sm"
                />
                <ToolbarButton label="Set" onClick={applyLink} />
              </div>
            )}
          </div>
          <EditorContent editor={editor} />
        </section>

        <section className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2 rounded-t-lg border-b border-stone-200 bg-stone-50 p-2">
            <span className="text-sm font-semibold text-stone-700">
              Markdown
            </span>
            <button
              type="button"
              className="min-h-9 rounded border border-stone-300 bg-white px-2 text-sm"
              onClick={() =>
                editor.commands.setContent(markdown, {
                  contentType: "markdown",
                })
              }
            >
              Apply to editor
            </button>
            <button
              type="button"
              className="min-h-9 rounded border border-stone-300 bg-white px-2 text-sm"
              onClick={checkRoundTrip}
            >
              Round-trip check
            </button>
            {roundTrip && (
              <span
                className={`text-sm font-bold ${
                  roundTrip === "pass" ? "text-green-700" : "text-red-700"
                }`}
              >
                {roundTrip === "pass" ? "✓ lossless" : "✗ lossy (see console)"}
              </span>
            )}
          </div>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck={false}
            className="min-h-64 flex-1 rounded-b-lg bg-stone-900 p-4 font-mono text-sm text-stone-100"
          />
        </section>
      </main>
    </div>
  );
}
