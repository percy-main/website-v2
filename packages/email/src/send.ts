import type { Email } from "./types.js";
import { devSend } from "./devSend.js";
import { sesSend } from "./sesSend.js";

const provider = process.env.EMAIL_PROVIDER ?? "dev";

export const send: (email: Email) => Promise<void> =
  provider === "dev" ? devSend : sesSend;
