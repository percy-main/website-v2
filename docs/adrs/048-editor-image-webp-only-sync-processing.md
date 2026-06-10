# ADR 048: Editor-uploaded images get a WebP-only ladder, processed synchronously

## Status

Accepted

## Context

Editor image uploads (ADR 047 content editing) flow: presign -> browser PUT of the original to S3 -> `POST /admin/content-images` confirms, and the API downloads the original, strips EXIF/GPS, builds a responsive ladder with sharp, writes the variants under `uploads/content/<id>/`, and registers a `content_image` row. The first implementation mirrored the static MDX corpus exactly: AVIF + WebP at every ladder width plus an original-format fallback, encoded inside the confirm request.

In production this 504ed on the first real upload. The API runs on a 0.25 vCPU Fargate task; encoding the AVIF half of the ladder took the total processing time to ~75-80 seconds, past the ALB's 60-second idle timeout. The ALB returned 504, the editor showed a failure - and the API kept going, finished the variants, wrote the DB row, and deleted the pending original. A retry of the confirm then 404ed ("upload may have expired") because the pending object was gone, even though the image was fully registered. From the editor's chair: uploads always fail, yet images mysteriously accumulate in the library.

## Decision

Three changes, smallest viable footprint:

1. **WebP-only ladder for editor uploads.** Dynamic uploads encode WebP at each ladder width plus the original-format fallback at the largest width. No AVIF. The static corpus (vite-imagetools at build time, on CI machines) keeps AVIF + WebP. The original is also decoded exactly once into a raw master at the largest ladder width; all variants derive from it instead of re-decoding a potentially 20-megapixel original per variant.
2. **Idempotent confirm.** `POST /admin/content-images` first checks for an existing `content_image` row and returns it if present, so a retry after a timeout (or a double-click) succeeds instead of 404ing on the deleted pending object.
3. **ALB `idle_timeout` raised 60s -> 120s** as headroom for worst-case originals (10MB cap), not as the primary fix.

## Problem

- **CPU budget is the binding constraint.** 0.25 vCPU is a deliberate cost choice (club budget, always-on task). AVIF encode cost at that allocation is measured in tens of seconds per image - no parameter tuning brings it safely inside a synchronous request budget.
- **Requests have a hard deadline.** Whatever the processing pipeline does must reliably finish inside the gateway timeout, including for the 10MB worst case, or the UX is a lie.
- **Half-finished failure is worse than failure.** The timeout left the system in a state where the work succeeded but the client could neither see it nor retry into it.

## Options considered

1. **WebP-only ladder + single-decode master + idempotent confirm** (chosen). Removes ~85% of the encode cost; WebP support is universal in browsers that reach this site.
2. **Keep AVIF, bump Fargate CPU to 1 vCPU.** Roughly 4x the always-on compute cost for an operation that happens a handful of times a week, and 4x faster still leaves the 10MB worst case uncomfortably close to the deadline.
3. **Async processing: confirm returns 202, a background job builds variants, the client polls.** The architecturally correct shape for unbounded work, but needs a job table or queue, a status endpoint, and editor placeholder states - real complexity the current upload volume does not justify.
4. **Raise timeouts only (ALB to 120s+).** Keeps a 75-second spinner in the editor, stays fragile against bigger originals, and a quarter-vCPU task pegged for that long starves health checks and every other request it is serving.

## Rationale

- **AVIF's marginal win does not survive contact with the CPU budget.** AVIF saves roughly 20-30% over WebP at comparable quality. For a club content page, that is a handful of KB per image, against a feature that otherwise does not work at all.
- **The ladder still does its job.** WebP at five widths plus an original-format fallback is exactly what `OptimisedImage` consumes; it iterates whatever formats are present, so no frontend change is needed.
- **Idempotency is required regardless of speed.** Any synchronous design can hit a timeout or a dropped connection after the row is written; returning the registered row on retry is correct independent of the encoding choice.
- **Decode-once is free correctness margin.** Deriving variants from a raw master at the largest ladder width turns the worst case (large PNG/JPEG originals) from N full decodes into one, with no visible quality cost for downscaled web variants.

## Rejected alternatives

- **AVIF parity with the static corpus** - rejected on encode cost at 0.25 vCPU. Becomes attractive again if processing moves off the request path (option 3) or onto bigger CPU.
- **Fargate CPU bump** - rejected as paying 4x always-on for a rare spike. Becomes attractive if baseline API load grows to need the CPU anyway.
- **Async background processing** - rejected as unjustified complexity at current volume, not on principle. This is the designated escape hatch: if uploads grow (match photo galleries, multi-image posts) or AVIF becomes a requirement, move processing to a worker and re-add AVIF there rather than re-tuning the synchronous path.
- **Timeout raise alone** - rejected as a band-aid that degrades the whole API while one request hogs the task. The 120s `idle_timeout` is kept only as headroom behind the real fix.

## Related

- ADR 047 - content editor (BlockNote), the feature this upload path serves.
- `apps/api/src/features/content-images/service.ts` - ladder construction (`LADDER_FORMATS`), single-decode master, idempotent confirm.
- `infra/modules/ecs-service/main.tf` - ALB `idle_timeout`, task CPU/memory.
- Incident: production upload 2026-06-10, image `bacc0432-1f2f-40d4-848e-868b3693723a` - variants and DB row written, browser saw 504.
