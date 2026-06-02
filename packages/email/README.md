# @percy-main/email

React Email templates plus the send logic that delivers them. Consumed by `apps/api`; previewed by `apps/email-viewer`.

## Layout

- `src/templates/` — one React Email component per transactional message (verify email, reset password, payment reminder, etc.).
- `src/send.ts` — `createSend(config)` returns a send function chosen by provider: `dev` writes to disk, `ses` sends via AWS SESv2 (`devSend.ts` / `sesSend.ts`).
- `src/email.ts` — the `email()` decorator that attaches subject + preview props to a template.
- `src/styles.ts`, `src/types.ts` — shared inline styles and the `Email` / `EmailConfig` types.

## Usage

App code calls `createSend({ provider, ... })` once at startup, then calls the returned function with an `Email`. The `dev` provider writes HTML + metadata to `apps/api/.emails/` (no real send); production uses `ses`.

## Preview

`pnpm dev` (in this package) starts the React Email preview server (port 3100), rendering every template with its decorator's preview props. This is the place to iterate on template markup. To inspect emails actually produced by a running API in dev, use [`apps/email-viewer`](../../apps/email-viewer/README.md) instead.

## Non-obvious notes

- SES sends both HTML and a plaintext fallback; the plaintext is auto-derived via `html-to-text`, so you don't write a text version.
- A template's preview props are what the preview server renders — keep them realistic.
