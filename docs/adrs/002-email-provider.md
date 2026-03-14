# Decision 002: Email Provider — SES over Mailgun

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Replace Mailgun with **Amazon SES** for transactional email in the new codebase.

## Options Considered

### Amazon SES (chosen)

- Part of the AWS ecosystem — covered by AWS credits
- eu-west-2 region keeps email infrastructure in the same region as compute
- Simple API via `@aws-sdk/client-sesv2`
- Extremely low cost ($0.10/1,000 emails)
- Domain verification via Route 53 (same console)

### Keep Mailgun

- Currently working, proven setup
- Would add a separate billing relationship
- Not covered by AWS credits

### SendGrid / Postmark

- Good products but introduce additional third-party dependencies
- Not covered by AWS credits

## Rationale

The migration plan explicitly proposes replacing Mailgun with SES. Since all infrastructure is consolidating onto AWS and email costs are negligible ($0.05/mo at current volume), SES is the clear choice. The `@percy-main/email` package abstracts the provider behind a `send()` function, making future provider changes trivial.

The dev environment still writes emails to `.emails/` files for local inspection — no external service needed during development.
