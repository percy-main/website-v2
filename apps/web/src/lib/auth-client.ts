import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient: ReturnType<typeof createAuthClient> =
  createAuthClient({
    plugins: [passkeyClient(), twoFactorClient(), adminClient()],
  });

export const { useSession } = authClient;
