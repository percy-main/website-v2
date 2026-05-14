import { z } from "zod";

/**
 * URL schema that only accepts http:// or https:// — rejects `javascript:`,
 * `data:`, `file:`, and the other schemes that would let a malicious tool
 * input become an XSS vector when rendered as `<img src>` / `<a href>`.
 *
 * Used wherever a tool's structured output flows directly into the FE
 * (recognition images, source links, face crop URLs).
 *
 * NOT applied to hostnames — `localhost:4566` (Localstack) and
 * `bucket.s3.region.amazonaws.com` both need to validate. Hostname
 * trustworthiness is enforced separately (e.g. SSRF guards in
 * face-detection.ts:fetchImageBytes).
 */
export const httpUrlSchema = z.url({ protocol: /^https?$/ });
