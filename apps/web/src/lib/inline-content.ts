// BlockNote inline-content primitives shared by the public renderer
// (content-body.tsx) and the AI assistant's draft projection. Lives outside
// the component files so Fast Refresh can preserve component state.

export interface StyledText {
  type: "text";
  text: string;
  styles?: Record<string, unknown> | null;
}

export interface InlineLink {
  type: "link";
  href: string;
  content: unknown;
}

export function isStyledText(node: unknown): node is StyledText {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "text" &&
    typeof (node as { text?: unknown }).text === "string"
  );
}

export function isInlineLink(node: unknown): node is InlineLink {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "link" &&
    typeof (node as { href?: unknown }).href === "string"
  );
}

/** Plain-text projection of inline content (code blocks, alt text, the AI
 *  assistant's draft listing). */
export function inlineToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((node) => {
      if (isStyledText(node)) return node.text;
      if (isInlineLink(node)) return inlineToText(node.content);
      return "";
    })
    .join("");
}
