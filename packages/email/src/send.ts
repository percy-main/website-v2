import { devSend } from "./devSend.js";
import { sesSend } from "./sesSend.js";
import type { Email } from "./types.js";

const provider = process.env.EMAIL_PROVIDER ?? "dev";

export const send: (email: Email) => Promise<void> =
  provider === "dev" ? devSend : sesSend;
