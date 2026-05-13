import { passkeyClient } from "@better-auth/passkey/client";
import { ac, roles } from "@percy-main/shared/auth/permissions";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
// VITE_API_URL is e.g. "https://api.v2.percymain.org/api" — strip the /api
// suffix since better-auth appends its own basePath (/api/auth).
const baseURL = apiUrl.replace(/\/api$/, "");

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: {
    // Cross-subdomain cookies are scoped to .percymain.org by the API.
    // Sending credentials is what makes the cookie attach to API calls
    // from matchday.percymain.org → api.v2.percymain.org.
    credentials: "include",
  },
  plugins: [passkeyClient(), twoFactorClient(), adminClient({ ac, roles })],
});

export const { useSession } = authClient;
