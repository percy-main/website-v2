# apps/email-viewer

A tiny dev-only tool for previewing transactional emails the API renders during local development. Not built, tested, or deployed.

## How it works

When the API runs with the `dev` email provider it writes each rendered message (HTML + metadata) to `apps/api/.emails/`. This app is a Vite dev server with a middleware plugin that lists those files and previews them in an iframe.

## Running

`pnpm dev` (Vite on port 5174). Run it alongside the API in dev mode — there's nothing to see until the API has sent at least one email.

For previewing email _templates_ in isolation (independent of the API), use the React Email preview server in [`packages/email`](../../packages/email/README.md) instead.
