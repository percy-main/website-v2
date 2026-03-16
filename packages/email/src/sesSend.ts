import { htmlToText } from "html-to-text";
import type { Email, EmailConfig } from "./types.js";

export function createSesSend(
  config: Pick<EmailConfig, "sesRegion" | "fromAddress">,
) {
  return async ({ to, subject, html }: Email) => {
    const { SESv2Client, SendEmailCommand } =
      await import("@aws-sdk/client-sesv2");

    const client = new SESv2Client({ region: config.sesRegion });

    await client.send(
      new SendEmailCommand({
        FromEmailAddress: config.fromAddress,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: {
              Html: { Data: html },
              Text: { Data: htmlToText(html) },
            },
          },
        },
      }),
    );
  };
}
