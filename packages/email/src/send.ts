import { devSend } from "./devSend.ts";
import { createSesSend } from "./sesSend.ts";
import type { Email, EmailConfig } from "./types.ts";

export function createSend(
  config: EmailConfig,
): (email: Email) => Promise<void> {
  if (config.provider === "dev") {
    return devSend;
  }
  return createSesSend(config);
}
