import { htmlToText } from "html-to-text";
import type { Email } from "./types.js";

const region = process.env.SES_REGION ?? "eu-west-2";
const fromAddress =
  process.env.SES_FROM_ADDRESS ??
  "Percy Main CSC Support <support@notifications.percymain.org>";

export const sesSend = async ({ to, subject, html }: Email) => {
  // Dynamic import to avoid requiring AWS SDK when not needed
  const { SESv2Client, SendEmailCommand } = await import(
    "@aws-sdk/client-sesv2"
  );

  const client = new SESv2Client({ region });

  await client.send(
    new SendEmailCommand({
      FromEmailAddress: fromAddress,
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
