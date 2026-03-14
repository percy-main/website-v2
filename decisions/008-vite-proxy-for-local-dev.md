# Decision 008: Vite Dev Server Proxy for Local Development

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Configure Vite's dev server to proxy `/api` requests to the local Fastify API server at `http://localhost:3000`. This avoids CORS issues during local development and mirrors the production setup where CloudFront routes `/api` to the ALB.

## Configuration

```typescript
// apps/web/vite.config.ts
server: {
  port: 5173,
  proxy: {
    "/api": {
      target: "http://localhost:3000",
      changeOrigin: true,
    },
  },
},
```

## Production

In production, CloudFront (or ALB) handles routing:
- `percymain.org/*` → S3 (frontend)
- `api.percymain.org/*` or `percymain.org/api/*` → ALB → ECS (API)

The exact production routing strategy (subdomain vs path prefix) will be decided when the CDN module is implemented in Phase 4.
