# Decision 007: Stripe Webhook Raw Body Handling

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Register a custom Fastify content type parser for the webhook route that preserves the raw request body as a string, required for Stripe signature verification.

## Context

Stripe webhook signature verification requires the raw request body (before JSON parsing). Fastify normally parses JSON automatically. The webhook route registers its own parser that keeps the body as a string.

## Options Considered

### Custom content type parser on the route (chosen)

- Scoped to the webhook plugin only
- Clean Fastify pattern — doesn't affect other routes
- Raw body available as `request.body` (typed as string)

### @fastify/raw-body plugin

- Adds raw body to all routes (unnecessary overhead)
- Additional dependency

### Separate Express app for webhooks

- Over-engineered for one route
