import { passkeyClient } from "@better-auth/passkey/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient: ReturnType<typeof createAuthClient> = createAuthClient(
  {
    plugins: [passkeyClient(), twoFactorClient(), adminClient()],
  },
);

export const { useSession } = authClient;
