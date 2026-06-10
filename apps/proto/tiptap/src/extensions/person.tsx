import { Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { PEOPLE } from "../people";
import { PersonCard } from "../person-card";

// Matches the remark-directive shortcode the content pipeline uses:
// ::person{slug="alex-slaven"}
const DIRECTIVE_RE = /^::person\{slug="([^"]+)"\}(?:\n+|$)/;

function PersonView({ node, updateAttributes, selected }: NodeViewProps) {
  const slug = node.attrs.slug as string;
  return (
    <NodeViewWrapper
      className={`my-4 rounded-lg ${selected ? "ring-2 ring-blue-400" : ""}`}
      data-person-slug={slug}
    >
      <div contentEditable={false} className="flex flex-col items-start gap-2">
        <PersonCard slug={slug} />
        <select
          aria-label="Person"
          value={slug}
          onChange={(e) => updateAttributes({ slug: e.target.value })}
          className="rounded border border-stone-300 bg-white p-1 text-sm"
        >
          {PEOPLE.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </NodeViewWrapper>
  );
}

export const Person = Node.create({
  name: "person",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return { slug: { default: PEOPLE[0].slug } };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-person-slug]",
        getAttrs: (el) => ({ slug: (el as HTMLElement).dataset.personSlug }),
      },
    ];
  },

  renderHTML({ node }) {
    return ["div", { "data-person-slug": node.attrs.slug }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PersonView);
  },

  markdownTokenizer: {
    name: "person",
    level: "block",
    start: (src: string) => src.indexOf("::person"),
    tokenize: (src: string) => {
      const match = DIRECTIVE_RE.exec(src);
      if (!match) {
        return undefined;
      }
      return { type: "person", raw: match[0], slug: match[1] };
    },
  },

  parseMarkdown: (token) => ({
    type: "person",
    attrs: { slug: (token as { slug?: string }).slug },
  }),

  renderMarkdown: (node) => `::person{slug="${node.attrs?.slug}"}`,
});
