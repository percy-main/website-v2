import { passkeyClient } from "@better-auth/passkey/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
// VITE_API_URL is e.g. "https://api.v2.percymain.org/api" — strip the /api
// suffix since better-auth appends its own basePath (/api/auth).
const baseURL = apiUrl.replace(/\/api$/, "");

export const authClient = createAuthClient({
  baseURL,
  plugins: [passkeyClient(), twoFactorClient(), adminClient()],
});

export const { useSession } = authClient;
