# better-auth Cross-Subdomain Session Sharing Research

**Date:** April 2026  
**better-auth version:** ^1.5.4 (current in repo; 1.6.7 available)  
**Scope:** Sharing authenticated sessions between `api.percymain.org`, `percymain.org` / `www.percymain.org`, and the new `matchday.percymain.org`

## 1. Cookie Config for Cross-Subdomain Sharing

### Domain Setting

Use `.percymain.org` (with leading dot) as the cookie domain. This allows the cookie to be readable by all subdomains of `percymain.org`:

```typescript
// apps/api/src/features/auth/auth.ts

return betterAuth({
  baseURL: apiBaseURL, // https://api.percymain.org
  basePath: "/api/auth",
  // ... other config
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
      domain: ".percymain.org" // Root domain with dot prefix
    }
  },
  // ... rest of config
});
```

**Important:** The leading dot is required. Using `percymain.org` without the dot restricts the cookie to that exact domain only. The dot notation is the standard for subdomain-inclusive cookies per RFC 6265.

### Security Attributes

Better-auth automatically sets cookies with:
- **`httpOnly: true`** — Prevents JavaScript from accessing the session token (protects against XSS).
- **`secure: true`** (in production) — Cookies only sent over HTTPS.
- **`sameSite: "Lax"` or `"Strict"`** (default: "Lax") — Mitigates CSRF. "Lax" allows top-level navigations but blocks cross-site form submissions; "Strict" blocks both.

No custom modifications needed unless you have a specific reason to weaken these protections. In dev with `localhost`, you may need to disable `secure` via the config.

### Production vs. Dev

For **development** with `localhost:3000` (API), `localhost:5173` (main), `localhost:5174` (matchday):

Localhost cookies **do not support domain-based sharing**. You must use the same origin or configure a reverse proxy. Options:
1. Run all three on different ports with a reverse proxy (e.g., `auth.localhost`, `app.localhost`, `matchday.localhost` via `/etc/hosts`).
2. Accept that dev has separate session stores and use `ngrok` or similar to test cross-subdomain sharing.
3. Disable the `secure` flag in dev and rely on path-based separation.

**Recommendation:** In dev, test cross-subdomain only with `.localhost` domain entries in `/etc/hosts`, or skip to prod testing.

## 2. trustedOrigins Configuration

The current setup already includes `trustedOrigins`:

```typescript
// Current (apps/api/src/features/auth/auth.ts, lines 23–25)
trustedOrigins: [baseURL, config.DEPLOY_PRIME_URL].filter(Boolean) as string[]
```

Extend it to include the new matchday SPA:

```typescript
trustedOrigins: [
  baseURL,                                    // https://percymain.org (or www.)
  "https://matchday.percymain.org",           // New subdomain
  config.DEPLOY_PRIME_URL,                    // Preview/staging URL
].filter(Boolean) as string[]
```

### Impact on CORS and CSRF

- **CORS:** `trustedOrigins` does not control CORS headers directly; it validates redirect URIs and OAuth callback URLs. CORS is typically handled by browser and server-side middleware (not better-auth-specific).
- **CSRF:** better-auth validates that POST/PUT/DELETE requests originate from `trustedOrigins` (via Origin/Referer headers). Adding `https://matchday.percymain.org` allows auth requests from that origin without CSRF rejection.
- **No explicit CORS header configuration required** in better-auth itself if you're using cookies. The browser automatically includes credentials if `credentials: 'include'` is set on fetch calls.

## 3. Client-Side Setup on the New App

### Initializing the Auth Client

The new matchday SPA should point its better-auth client at the API subdomain:

```typescript
// apps/web-matchday/src/lib/auth.ts (new)

import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: "https://api.percymain.org", // Use API subdomain, not matchday domain
  // Or use relative path if matchday is served from api.percymain.org/*
});
```

### Fetch Options and Credentials

Better-auth client automatically handles `credentials: 'include'` for all requests. Verify your HTTP client includes credentials:

```typescript
// Explicit configuration if needed:
const authClient = createAuthClient({
  baseURL: "https://api.percymain.org",
  fetchOptions: {
    credentials: "include", // Required for cross-subdomain cookies
  },
});
```

If using React Query or a custom fetch wrapper, ensure all auth-related requests use `credentials: 'include'`:

```typescript
// Example: custom fetch wrapper
export const apiClient = (url: string, options: RequestInit = {}) => {
  return fetch(url, {
    ...options,
    credentials: "include", // Essential for session cookies
  });
};
```

### Base URL Recommendation

Use the **API subdomain explicitly** rather than relative paths. This ensures cookies set by `api.percymain.org` are recognized when the client runs on `matchday.percymain.org`.

## 4. Login Redirects and Return URLs

### Out-of-the-Box Behavior

Better-auth does **not** have a built-in redirect mechanism for unauthenticated users. Options:

1. **Client-side guard (React Router):**
   ```typescript
   function ProtectedRoute() {
     const { data: session, isPending } = useQuery({
       queryKey: ["session"],
       queryFn: () => authClient.getSession(),
     });

     if (isPending) return <div>Loading...</div>;
     if (!session) {
       return <Navigate to={`https://percymain.org/login?redirect=${window.location.href}`} />;
     }
     return <Outlet />;
   }
   ```

2. **Server-side guard (if matchday is SSR):** Check session in loader/middleware, redirect before rendering.

### Return URL Pattern

Implement a custom `?redirect=` parameter:

```typescript
// On main site's login page, check URL params
const loginUrl = new URL(window.location.href);
const redirect = loginUrl.searchParams.get("redirect");

// After login succeeds, redirect back
await authClient.signIn.email({ email, password });
if (redirect) {
  window.location.href = redirect;
}
```

This pattern is framework-agnostic and widely used. Better-auth does not enforce it, so you own the security (validate that `redirect` is same-origin or a trusted domain).

## 5. Development Setup

### Localhost Limitations

Browsers do **not** share cookies across different ports on `localhost` (e.g., `localhost:3000` and `localhost:5173`). The SameSite and domain rules treat them as separate origins.

### Workaround: /etc/hosts + Reverse Proxy

1. Edit `/etc/hosts`:
   ```
   127.0.0.1 api.localhost
   127.0.0.1 app.localhost
   127.0.0.1 matchday.localhost
   ```

2. Run each service on a single port or use a reverse proxy:
   ```nginx
   server {
     listen 80;
     server_name api.localhost;
     proxy_pass http://127.0.0.1:3000;
   }

   server {
     listen 80;
     server_name app.localhost;
     proxy_pass http://127.0.0.1:5173;
   }

   server {
     listen 80;
     server_name matchday.localhost;
     proxy_pass http://127.0.0.1:5174;
   }
   ```

3. Update better-auth config for dev:
   ```typescript
   const isProduction = process.env.NODE_ENV === "production";

   return betterAuth({
     baseURL: isProduction
       ? "https://api.percymain.org"
       : "http://api.localhost",
     advanced: {
       crossSubDomainCookies: {
         enabled: true,
         domain: isProduction ? ".percymain.org" : ".localhost",
       },
       useSecureCookies: isProduction,
     },
     trustedOrigins: isProduction
       ? [
           "https://percymain.org",
           "https://www.percymain.org",
           "https://matchday.percymain.org",
         ]
       : ["http://app.localhost", "http://matchday.localhost"],
   });
   ```

## 6. Version Gotchas

### Current Version: 1.5.4 → 1.6.7

**Breaking changes to review:**
- **Cross-subdomain cookies plugin (PR #6359):** Recently merged but still under review. The cross-subdomain feature is available but underwent security fixes to prevent subdomain validation bypass. If upgrading to 1.6.x, test subdomain validation thoroughly.
- **Safari ITP (Intelligent Tracking Prevention):** If session cookies are set by `api.percymain.org` and read by `matchday.percymain.org`, Safari's ITP may block third-party cookies depending on user browsing behavior. Workaround: use a reverse proxy so auth is served from the same domain as the SPA, or set `sameSite: "None"` with `secure: true` (requires explicit user gesture).
- **OAuth state mismatch (Issue #5519):** Reported in 1.3.18+. If using OAuth, ensure `trustedOrigins` includes all subdomains to avoid state validation failures.

### Recommendation

Test with the current 1.5.4 first. Upgrade to 1.6.7+ only after testing the cross-subdomain feature in staging, especially if you use OAuth or need Safari compatibility.

---

## Summary Table

| Aspect | Setting | Notes |
|--------|---------|-------|
| **Cookie Domain** | `.percymain.org` | Leading dot required for subdomain inclusion. |
| **crossSubDomainCookies** | `{ enabled: true, domain: ".percymain.org" }` | Enables session sharing across all subdomains. |
| **trustedOrigins** | `["https://percymain.org", "https://matchday.percymain.org"]` | Add the new subdomain to prevent CSRF rejection. |
| **Client baseURL** | `https://api.percymain.org` | Point matchday client to the API, not the matchday domain. |
| **credentials** | `include` | Required on all fetch calls for cookie transmission. |
| **sameSite** | Lax (default) | Use Lax for top-level navigations; Strict for stricter CSRF. |
| **Dev Domain** | `.localhost` (via /etc/hosts) | localhost ports do not share cookies; use domain-based setup. |

## References

- [Better Auth Cookies Docs](https://better-auth.com/docs/concepts/cookies)
- [Better Auth Options Reference](https://better-auth.com/docs/reference/options)
- [Cross-Subdomain Cookies PR #6359](https://github.com/better-auth/better-auth/pull/6359)
