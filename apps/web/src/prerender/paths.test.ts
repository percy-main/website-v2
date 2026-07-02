import { describe, expect, it } from "vitest";
import {
  isSnapshotUrl,
  snapshotInvalidationPath,
  snapshotKvsKey,
  snapshotS3Key,
} from "./paths.js";

// These fixtures are pinned on the CloudFront side too
// (infra/modules/cdn/spa-rewrite.test.js) - the function derives the S3
// object from the KVS key by the same convention.

describe("prerender path mapping", () => {
  it("maps URLs to _prerender S3 keys", () => {
    expect(snapshotS3Key("/club")).toBe("_prerender/club.html");
    expect(snapshotS3Key("/club/history/honours")).toBe(
      "_prerender/club/history/honours.html",
    );
    expect(snapshotS3Key("/news/article/season-opener")).toBe(
      "_prerender/news/article/season-opener.html",
    );
  });

  it("uses the exact URL path as the KVS key", () => {
    expect(snapshotKvsKey("/person/jane-smith")).toBe("/person/jane-smith");
  });

  it("derives the invalidation path from the S3 key", () => {
    expect(snapshotInvalidationPath("/club")).toBe("/_prerender/club.html");
  });

  it("rejects URLs that can never be snapshots", () => {
    expect(isSnapshotUrl("/")).toBe(false);
    expect(isSnapshotUrl("")).toBe(false);
    expect(isSnapshotUrl("/club/")).toBe(false);
    expect(isSnapshotUrl("/club?x=1")).toBe(false);
    expect(isSnapshotUrl("/assets/index-abc.js")).toBe(false);
    expect(isSnapshotUrl("/Club")).toBe(false);
    expect(() => snapshotS3Key("/club/")).toThrow();
  });
});
