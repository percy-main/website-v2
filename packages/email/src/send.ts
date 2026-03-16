import { devSend } from "./devSend.js";
import { createSesSend } from "./sesSend.js";
import type { Email, EmailConfig } from "./types.js";

export function createSend(
  config: EmailConfig,
): (email: Email) => Promise<void> {
  if (config.provider === "dev") {
    return devSend;
  }
  return createSesSend(config);
}
