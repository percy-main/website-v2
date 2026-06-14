import { z } from "zod";

/**
 * Editor state the modal sends each turn. Kept loose (kind/metadata are
 * strings/records, not the full content union) because this only seeds the
 * system prompt - it never writes to the DB. The real content gates apply
 * when the user saves the draft through the content API.
 */
export const editorContextSchema = z.object({
  kind: z.string().min(1),
  title: z.string(),
  slug: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  existingBlockTypes: z.array(z.string()).optional(),
});
export type EditorContextInput = z.infer<typeof editorContextSchema>;

/**
 * Chat turn body. `messages` is the AI SDK UIMessage[] shape, kept opaque
 * (z.unknown) exactly like Scout's chatRequestBodySchema - the AI SDK owns
 * that contract and the route casts to UIMessage[].
 */
export const contentAuthorRequestBodySchema = z.object({
  messages: z.array(z.unknown()).min(1),
  editorContext: editorContextSchema,
});
export type ContentAuthorRequestBody = z.infer<
  typeof contentAuthorRequestBodySchema
>;
