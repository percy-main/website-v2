import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface AskQuestionToolDeps {
  writer: UIMessageStreamWriter;
}

const askQuestionInputSchema = z.object({
  question: z
    .string()
    .min(3)
    .max(280)
    .describe("The question to ask the user, in plain English."),
  options: z
    .array(
      z.object({
        label: z
          .string()
          .min(1)
          .max(80)
          .describe("Button label shown to the user."),
        value: z
          .string()
          .min(1)
          .max(280)
          .describe(
            "Text submitted as the user reply when this option is picked. Make it a complete answer (e.g. 'Yes — covers' rather than 'Yes') so the recorded fact reads naturally.",
          ),
      }),
    )
    .min(2)
    .max(6)
    .describe(
      "Two to six button options. Cover the realistic outcomes; the user can always type a free-text answer instead.",
    ),
  allowFreeText: z
    .boolean()
    .default(true)
    .describe(
      "Whether to render a free-text input alongside the buttons. Default true — never trap the user in multiple choice.",
    ),
});

/**
 * ask_question lets the agent surface a yes/no/multi-choice prompt as
 * inline UI rather than asking in prose and waiting for a typed reply.
 * The frontend renders a card with option buttons; clicking a button
 * sends the option's `value` as a normal user message, so the agent
 * picks up the answer through the standard chat loop.
 *
 * The tool emits a `data-question` UI part via the stream writer (same
 * pattern as chart_render / cite_match) and returns a small confirmation
 * to the model. The system prompt is responsible for telling the model
 * to STOP its step after asking — there's no further work to do until
 * the user replies.
 */
export function createAskQuestionTool(deps: AskQuestionToolDeps) {
  const { writer } = deps;

  return {
    ask_question: tool({
      description: `Ask the user a single question with clickable options. Use this in debrief mode whenever you need a small piece of information that has a small set of likely answers (yes/no, a category from a short list, etc.). The frontend renders a card with buttons; the user picks one or types a free-text answer.

Rules:
- One question per call. Don't try to ask multiple things in one prompt.
- Provide 2–6 options. Cover the realistic outcomes; the free-text input handles edge cases.
- Each option's \`value\` is the literal text submitted as the user's reply. Phrase it as a complete answer ("Yes — covers", "No covers", "Some matting only") so the next \`fact_record\` you make reads naturally.
- After calling ask_question, STOP this step. Do not continue with prose or other tool calls; wait for the user's reply in the next turn.

Don't use ask_question for open-ended questions (their feedback on a player's footwork, ground notes that don't fit a small option set) — ask in prose for those.`,
      inputSchema: askQuestionInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; this tool only writes a data part.
      execute: async ({
        question,
        options,
        allowFreeText,
      }: z.infer<typeof askQuestionInputSchema>) => {
        const id = randomUUID();
        writer.write({
          type: "data-question",
          id,
          data: { question, options, allowFreeText },
        });
        return { asked: true, questionId: id };
      },
    }),
  };
}

export type AskQuestionTools = ReturnType<typeof createAskQuestionTool>;
