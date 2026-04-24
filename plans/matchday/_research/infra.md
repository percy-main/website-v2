# Infrastructure Research: matchday.percymain.org Setup

## 1. Current better-auth Server Configuration

### Initialization & Options

The better-auth instance is created in `/Users/alexyoung/Code/website-v2/apps/api/src/features/auth/auth.ts` (lines 11–80).

**Key options:**
- **baseURL**: `config.API_BASE_URL` (e.g., `https://api.v2.percymain.org`)
- **basePath**: `/api/auth`
- **appName**: `config.BETTER_AUTH_RP_NAME` (e.g., `Percy Main CSC`)
- **trustedOrigins**: `[baseURL, config.DEPLOY_PRIME_URL]` (lines 23–25)
  - Currently references environment variables; hardcoded check during runtime via config schema
  - Example: `https://www.percymain.org` and preview URLs
- **Plugins**: passkey, twoFactor, admin, and conditionally dash (infra)

### Cookie Domain Configuration

**Critical finding:** **No explicit `cookieOptions` object is defined** in the better-auth initialization. The library uses defaults, which means:
- Cookie domain is **not explicitly set to `.percymain.org`**
- This likely defaults to the request origin's domain
- **Session cookies DO NOT currently share across `percymain.org` and `www.percymain.org`** without explicit domain configuration
- CORS/trusted origins are set per-origin but cookies require the domain attribute

To enable cross-domain session sharing for `matchday.percymain.org`, we need to add:
```typescript
cookieOptions: {
  domain: ".percymain.org", // shared domain
  ...
}
```

### Database & Plugins

- **Database**: PostgreSQL dialect injected at init time
- **Email & Password**: enabled with email verification required
- **Passkey/2FA**: enabled via plugins

---

## 2. Current better-auth Client Configuration

Located in `/Users/alexyoung/Code/website-v2/apps/web/src/lib/auth-client.ts` (lines 1–15).

**Setup:**
- **baseURL**: Computed from `VITE_API_URL` environment variable with `/api` suffix stripped (lines 5–8)
  - Input: `https://api.v2.percymain.org/api` → Output: `https://api.v2.percymain.org`
- **Plugins**: passkeyClient, twoFactorClient, adminClient
- **No explicit redirect handling** for apex vs www; relies on baseURL pointing to a single API endpoint

**Current flow**: Client always targets the same API base URL regardless of frontend origin. For `matchday.percymain.org`, it will need a separate build with `VITE_API_URL=https://api.v2.percymain.org/api` (same as main site).

---

## 3. Configuration & Environment Variables

Read from `/Users/alexyoung/Code/website-v2/apps/api/src/config.ts` (lines 1–85).

**Auth-related env vars (parsed via Zod schema):**

| Variable | Default | Notes |
|----------|---------|-------|
| `BETTER_AUTH_SECRET` | optional | Server secret; should be per-environment |
| `BETTER_AUTH_RP_ID` | "localhost" | Passkey relying party ID (affects passkey domain binding) |
| `BETTER_AUTH_RP_NAME` | "Percy Main CSC" | Display name for passkeys |
| `BASE_URL` | `http://localhost:5173` | Frontend origin for trustedOrigins |
| `API_BASE_URL` | **required** | API server URL (e.g., `https://api.v2.percymain.org`) |
| `DEPLOY_PRIME_URL` | optional | Netlify preview URL for preview deployments |
| `GOOGLE_CLIENT_ID/SECRET` | "" (optional) | OAuth provider credentials |

**Current Fastify CORS setup** (`/Users/alexyoung/Code/website-v2/apps/api/src/app.ts`, lines 124–135):
```typescript
await app.register(cors, {
  origin: config.BASE_URL,          // Single origin hardcoded
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
});
```

**Issue**: CORS is locked to a single `BASE_URL`. To support both `percymain.org` and `matchday.percymain.org`, this needs to be expanded to a regex or array of origins.

---

## 4. Terraform / Infrastructure

### Current Architecture

**Domains & DNS:**
- **percymain.org** (apex) → CloudFront distribution (S3 frontend)
- **www.percymain.org** → Added as CloudFront alias (not separate distribution)
- **kit.percymain.org** → CloudFront alias
- **api.v2.percymain.org** → ALB via Route 53 A/AAAA records

**ACM Certificates:**
- **ALB (eu-west-2)**: domain + wildcard (`*.percymain.org`)
  - File: `/Users/alexyoung/Code/website-v2/infra/environments/shared/main.tf` (lines 183–194)
  - Covers `api.v2.percymain.org` via wildcard
- **CloudFront (us-east-1)**: domain + wildcard (`*.percymain.org`)
  - File: same, lines 196–207
  - Region: **us-east-1 only** (CloudFront requirement)

**S3 Buckets:**
- `percy-main-production-frontend` (S3 + OAC access via CloudFront)
- `percy-main-production-uploads` (S3 + OAC access)

**CloudFront Distribution:**
- File: `/Users/alexyoung/Code/website-v2/infra/modules/cdn/main.tf` (lines 288–375)
- **Single distribution** for all aliases (apex, www, kit)
- **Default root object**: `index.html` (SPA rewrite)
- **Origins**: Two S3 buckets (frontend, uploads)
- **Aliases**: `["percymain.org", "www.percymain.org", "kit.percymain.org"]` (line 293)
- **Behavior**: Path-based routing (`/uploads/*` → uploads bucket, default → frontend bucket)

### Adding matchday.percymain.org

#### DNS & Certificate

Files to modify:

1. **`/Users/alexyoung/Code/website-v2/infra/environments/shared/main.tf`**
   - Lines 196–207: CloudFront cert already has `*.percymain.org` SAN
   - **No change needed** for DNS validation; SANs already cover `matchday.percymain.org`

2. **`/Users/alexyoung/Code/website-v2/infra/environments/production/main.tf`**
   - Line 192: Extend `extra_aliases` parameter:
     ```hcl
     extra_aliases = ["www.percymain.org", "kit.percymain.org", "matchday.percymain.org"]
     ```

#### CloudFront & S3

File: `/Users/alexyoung/Code/website-v2/infra/modules/cdn/main.tf`

**Recommended approach**: Add a new S3 bucket and origin for matchday, with path-based routing:
- Line 46: Add `matchday_bucket_name = "percy-main-${var.environment}-matchday"`
- Lines 68–117: Create new `aws_s3_bucket.matchday` + policies (copy frontend bucket pattern)
- Lines 302–313: Add third origin:
  ```hcl
  origin {
    domain_name              = aws_s3_bucket.matchday.bucket_regional_domain_name
    origin_id                = "s3-matchday"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }
  ```
- Lines 315–327: Add ordered behavior before default:
  ```hcl
  ordered_cache_behavior {
    path_pattern           = "/matchday/*"
    target_origin_id       = "s3-matchday"
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
  }
  ```

**Alternative (simpler)**: Use a single S3 bucket with folder structure (`/matchday/` prefix). Saves infrastructure but couples deployments.

#### Route 53

Currently DNS for `percymain.org` is managed by **Netlify** (not Route 53). Only `api.v2.percymain.org` is in Route 53.

**Action**: If `matchday.percymain.org` DNS needs to be managed by AWS:
- File: `/Users/alexyoung/Code/website-v2/infra/environments/production/main.tf`
- Add Route 53 record (optional; depends on current DNS hosting):
  ```hcl
  resource "aws_route53_record" "matchday_a" {
    zone_id = local.shared.zone_id
    name    = "matchday.percymain.org"
    type    = "A"
    alias {
      name                   = module.cdn.distribution_domain_name
      zone_id                = module.cdn.distribution_hosted_zone_id
      evaluate_target_health = false
    }
  }
  ```

### CI/CD Deployment

File: `/Users/alexyoung/Code/website-v2/.github/workflows/deploy.yml`

**Current flow:**
1. **Lines 322–332**: Single frontend build step (runs if web changed)
   - Env: `VITE_API_URL: https://api.v2.percymain.org/api`
2. **Lines 339–351**: S3 sync to `FRONTEND_BUCKET`
   - All assets (except `index.html` and `*.json`) cached forever
   - `index.html` and JSON files: no-cache
3. **Lines 353–357**: CloudFront invalidation
   - Only `/index.html` and `/*.json` paths invalidated

**For matchday SPA:**
- Option A: **Separate frontend build + bucket + invalidation**
  - Requires new `MATCHDAY_FRONTEND_BUCKET` variable
  - New job: `deploy-matchday-web` (conditional on matchday code changes)
  - Independent deploy cycle
  
- Option B: **Path-based deployment** (if using shared bucket)
  - Sync `apps/matchday/dist/` to `s3://percy-main-production-frontend/matchday/`
  - Invalidate `/matchday/*` in CloudFront
  - Couples with main site deployments

**Recommended**: Option A (separate bucket/invalidation) for isolation and independent deploy control.

---

## 5. Gotchas & Considerations

### Authentication & Cookies

1. **Cookie domain not currently set**: Session cookies won't share across subdomains without explicit `domain: ".percymain.org"` configuration in better-auth
2. **CORS origin hardcoded**: API currently accepts CORS only from single `BASE_URL`; must expand to array for multi-SPA support
3. **Passkey RP ID**: If set to a subdomain (vs root), passkeys won't work cross-domain; needs root domain binding

### Infrastructure

1. **Single CloudFront distribution, multiple aliases**: Good for cost; requires careful path-based routing. Risk: misconfigured behaviors affect all aliases
2. **ACM certificate in us-east-1**: CloudFront requires this; regional ALB cert is in eu-west-2. **Don't mix regions**
3. **S3 CORS configuration** (`/infra/modules/cdn/main.tf`, lines 200–209): Currently allows uploads from single domain. Must extend to `["https://www.percymain.org", "https://matchday.percymain.org", ...]`
4. **Netlify manages percymain.org DNS**: Route 53 only covers `api.v2.*`. Verify DNS is configured for matchday before deploying

### Deployment & Cache

1. **Frontend bucket is shared** between www and kit; adding matchday adds third consumer
2. **CloudFront cache invalidation is broad**: Currently invalidates `/index.html` + `/*.json` globally; may affect unrelated aliases
3. **No canary or blue-green**: Deploy directly to production S3; old cache served from CloudFront during max-age window

### Role & Permission Model

- **No role field detected** in the user schema explored; all users get same API access
- For matchday (if restricted), need to:
  - Add `role` column to user table
  - Update better-auth config to include role claims in session tokens
  - Protect matchday API routes via middleware checking role

---

## Summary: Implementation Roadmap

**Phase 1: Infrastructure**
1. Extend ACM cert SAN to include matchday (already done via wildcard)
2. Add `matchday.percymain.org` to CloudFront aliases in `infra/environments/production/main.tf:192`
3. Create new S3 bucket + origin + behavior in `infra/modules/cdn/main.tf`
4. (Optional) Add Route 53 CNAME if DNS managed by AWS

**Phase 2: API Configuration**
1. Update `CORS origin` in `apps/api/src/app.ts:125` from single string to array/regex
2. Update `trustedOrigins` in `apps/api/src/features/auth/auth.ts:23–25` to include matchday domain
3. Add `cookieOptions` with `.percymain.org` domain for session sharing
4. Update S3 CORS config to allow matchday origin

**Phase 3: Frontend & Deployment**
1. Create `apps/matchday` with shared auth-client setup
2. Add `deploy-matchday-web` job in `.github/workflows/deploy.yml` (or reuse existing with parameterization)
3. Configure `MATCHDAY_FRONTEND_BUCKET` and `VITE_API_URL` in GitHub variables
4. Test auth flow across `www.percymain.org` ↔ `matchday.percymain.org`

**Phase 4: Validation**
1. Verify cookies are shared (inspect Set-Cookie domain attribute in DevTools)
2. Verify CORS headers allow matchday origin
3. Test passkey registration across origins
4. Load test CloudFront distribution with three aliases
