// URL <-> storage mappings for prerendered documents. The CloudFront
// Function (infra/modules/cdn/spa-rewrite.js) derives the S3 object from
// the KVS key BY CONVENTION - `"/_prerender" + uri + ".html"` - so this
// module and that function must agree byte-for-byte. Its tests pin the
// same fixtures (infra/modules/cdn/spa-rewrite.test.js).

export const PRERENDER_S3_PREFIX = "_prerender";

/**
 * A public URL path eligible for snapshotting: absolute, extensionless,
 * no trailing slash (except never "/" itself - the home page is not CMS
 * content), no query/hash.
 */
export function isSnapshotUrl(url: string): boolean {
  return /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(url);
}

/** `/club/history` -> `_prerender/club/history.html` (S3 object key, no leading slash). */
export function snapshotS3Key(url: string): string {
  if (!isSnapshotUrl(url)) {
    throw new Error(`Not a snapshot-eligible URL: ${url}`);
  }
  return `${PRERENDER_S3_PREFIX}${url}.html`;
}

/** The KVS key for a snapshot: the exact public URL path. */
export function snapshotKvsKey(url: string): string {
  if (!isSnapshotUrl(url)) {
    throw new Error(`Not a snapshot-eligible URL: ${url}`);
  }
  return url;
}

/** The CloudFront invalidation path for one snapshot's cache entry. */
export function snapshotInvalidationPath(url: string): string {
  return `/${snapshotS3Key(url)}`;
}
