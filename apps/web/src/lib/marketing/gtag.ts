/**
 * Thin wrapper around gtag. No consent gate here - Consent Mode v2 handles
 * denied/granted transparently. We always emit; gtag decides what it's
 * allowed to send.
 */
export function trackEvent(
  name: string,
  params?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  window.gtag?.("event", name, params ?? {});
}

/**
 * SHA-256 hex digest of a normalised email. Used for Enhanced Conversions;
 * the caller must only attach the hash when ad_user_data consent is granted.
 */
export async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
