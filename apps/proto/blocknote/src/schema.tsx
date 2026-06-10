import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { PEOPLE } from "./people";
import { PersonCard } from "./person-card";

// Custom block for the remark-directive shortcode ::person{slug="..."}.
// Rendered read-only in the editor, same as the published page.
const personBlock = createReactBlockSpec(
  {
    type: "person",
    propSchema: {
      slug: { default: PEOPLE[0].slug },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <div className="my-2 flex flex-col items-start gap-2">
        <PersonCard slug={block.props.slug} />
        <select
          aria-label="Person"
          value={block.props.slug}
          onChange={(e) =>
            editor.updateBlock(block, {
              type: "person",
              props: { slug: e.target.value },
            })
          }
          className="rounded border border-stone-300 bg-white p-1 text-sm"
        >
          {PEOPLE.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    ),
  },
);

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    person: personBlock(),
  },
});

export type Editor = typeof schema.BlockNoteEditor;
export type Block = typeof schema.Block;
export type PartialBlock = typeof schema.PartialBlock;
