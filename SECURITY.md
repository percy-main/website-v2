# Security Policy

## Supported versions

Only `main` (the deployed branch) is supported. There are no released
versions or back-ports.

## Reporting a vulnerability

If you've found a security issue in this codebase or any of the
services it operates (api.v2.percymain.org, v2.percymain.org), please
**do not open a public GitHub issue**.

Instead, report privately via one of:

- **Email:** alex@alexyoung.info — encrypt with PGP if you have it,
  otherwise plain email is fine
- **GitHub Security Advisory:** use the "Report a vulnerability"
  button on the [Security tab](https://github.com/percy-main/website-v2/security/advisories/new)
  of this repository

Please include:

- A description of the vulnerability and the affected component
- Reproduction steps or a proof-of-concept
- The impact you believe it has
- Your name / handle so we can credit you (or "anonymous" — your call)

## What to expect

- **Acknowledgement** within 3 working days
- An initial **assessment** (severity, scope) within 7 working days
- A **fix or mitigation** target depending on severity:
  - Critical (auth bypass, RCE, mass data exposure): hours-to-days
  - High: 1-2 weeks
  - Medium / low: best-effort, typically rolled into the next sprint
- A **disclosure timeline** agreed with you before any public write-up

## Scope

In scope:

- This repository's source code
- The deployed services it operates
- Configuration in `infra/` (Terraform-managed AWS infra)

Out of scope:

- Third-party services we depend on (Stripe, AWS, New Relic, Play
  Cricket, Google Maps) — please report directly to the vendor
- Social engineering of club members or volunteers
- Physical access to club facilities

## Safe harbour

Good-faith security research is welcome. We will not pursue legal
action against researchers who:

- Make a reasonable effort to avoid privacy violations and service
  disruption
- Report findings privately and give us reasonable time to fix them
  before public disclosure
- Do not exfiltrate or retain data beyond what's needed to demonstrate
  the issue
