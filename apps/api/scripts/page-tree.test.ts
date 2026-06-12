import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  buildPageTree,
  filePathToUrlPath,
  parentFailureReason,
  type PageNode,
} from "./page-tree.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.resolve(__dirname, "../../web/content/pages");

describe("filePathToUrlPath", () => {
  it("mirrors the web app's transform for plain files and _index", () => {
    expect(filePathToUrlPath("boxing.mdx")).toBe("/boxing");
    expect(filePathToUrlPath("charity/_index.mdx")).toBe("/charity");
    expect(filePathToUrlPath("cricket/ground/_index.mdx")).toBe(
      "/cricket/ground",
    );
    expect(filePathToUrlPath("cricket/ground/grounds-team.mdx")).toBe(
      "/cricket/ground/grounds-team",
    );
  });
});

describe("buildPageTree", () => {
  const fixture = [
    "boxing.mdx",
    "charity/_index.mdx",
    "charity/agm-2025.mdx",
    "cricket/_index.mdx",
    "cricket/ground/_index.mdx",
    "cricket/ground/grounds-team.mdx",
    "legal/_index.mdx",
    "legal/privacy.mdx",
  ];

  it("derives slug, path and parentPath from the directory layout", () => {
    const tree = buildPageTree(fixture);
    expect(tree.failed).toEqual([]);
    expect(tree.ordered).toEqual([
      { file: "boxing.mdx", slug: "boxing", path: "/boxing", parentPath: null },
      {
        file: "charity/_index.mdx",
        slug: "charity",
        path: "/charity",
        parentPath: null,
      },
      {
        file: "charity/agm-2025.mdx",
        slug: "agm-2025",
        path: "/charity/agm-2025",
        parentPath: "/charity",
      },
      {
        file: "cricket/_index.mdx",
        slug: "cricket",
        path: "/cricket",
        parentPath: null,
      },
      {
        file: "cricket/ground/_index.mdx",
        slug: "ground",
        path: "/cricket/ground",
        parentPath: "/cricket",
      },
      {
        file: "cricket/ground/grounds-team.mdx",
        slug: "grounds-team",
        path: "/cricket/ground/grounds-team",
        parentPath: "/cricket/ground",
      },
      {
        file: "legal/_index.mdx",
        slug: "legal",
        path: "/legal",
        parentPath: null,
      },
      {
        file: "legal/privacy.mdx",
        slug: "privacy",
        path: "/legal/privacy",
        parentPath: "/legal",
      },
    ]);
  });

  it("orders every parent before its children", () => {
    const tree = buildPageTree(fixture);
    const indexByPath = new Map(tree.ordered.map((n, i) => [n.path, i]));
    for (const node of tree.ordered) {
      if (node.parentPath === null) continue;
      const parentIndex = indexByPath.get(node.parentPath);
      expect(parentIndex).toBeDefined();
      expect(parentIndex).toBeLessThan(indexByPath.get(node.path) ?? -1);
    }
  });

  it("fails children of a directory with no _index.mdx, transitively", () => {
    const tree = buildPageTree([
      "cricket/senior/1st-xi.mdx",
      "cricket/senior/_index.mdx",
      // no cricket/_index.mdx
    ]);
    expect(tree.ordered).toEqual([]);
    expect(tree.failed).toEqual([
      {
        file: "cricket/senior/_index.mdx",
        path: "/cricket/senior",
        reason: "parent page required: no _index.mdx provides '/cricket'",
      },
      {
        file: "cricket/senior/1st-xi.mdx",
        path: "/cricket/senior/1st-xi",
        reason: "parent failed (/cricket/senior)",
      },
    ]);
  });

  it("fails a root _index.mdx (its path would be '/')", () => {
    const tree = buildPageTree(["_index.mdx"]);
    expect(tree.ordered).toEqual([]);
    expect(tree.failed).toHaveLength(1);
    expect(tree.failed[0]?.reason).toMatch(/root _index\.mdx/);
  });

  it("fails files whose slug is not a valid content slug", () => {
    const tree = buildPageTree(["Has Space.mdx"]);
    expect(tree.ordered).toEqual([]);
    expect(tree.failed[0]?.reason).toMatch(/not a valid content slug/);
  });
});

describe("parentFailureReason", () => {
  const node = (path: string, parentPath: string | null): PageNode => ({
    file: `${path.slice(1)}.mdx`,
    slug: path.split("/").pop() ?? "",
    path,
    parentPath,
  });

  it("fails a child whose parent failed, transitively in path order", () => {
    const failed = new Set<string>(["/cricket"]);
    const ground = node("/cricket/ground", "/cricket");
    expect(parentFailureReason(ground, failed)).toBe(
      "parent failed (/cricket)",
    );
    // The script adds the failed child to the set before its children
    // are processed - so the failure propagates down the whole subtree.
    failed.add(ground.path);
    expect(
      parentFailureReason(
        node("/cricket/ground/grounds-team", "/cricket/ground"),
        failed,
      ),
    ).toBe("parent failed (/cricket/ground)");
  });

  it("does not fail unrelated subtrees or root pages", () => {
    const failed = new Set<string>(["/cricket"]);
    expect(
      parentFailureReason(node("/charity/agm-2025", "/charity"), failed),
    ).toBe(null);
    expect(parentFailureReason(node("/boxing", null), failed)).toBe(null);
  });
});

describe("real corpus parity", () => {
  it("derives the same path as the web app's filePathToUrlPath for every page", async () => {
    const files = (await fs.readdir(PAGES_DIR, { recursive: true }))
      .filter((f) => f.endsWith(".mdx"))
      .map((f) => f.split(path.sep).join("/"))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    const tree = buildPageTree(files);

    // Structure: the real corpus must produce no structural failures -
    // every file lands in ordered.
    expect(tree.failed).toEqual([]);
    expect(tree.ordered.map((n) => n.file).sort()).toEqual(files);

    // Paths: structural derivation (parent path + slug) agrees with the
    // web app's file-path transform for every single page.
    for (const node of tree.ordered) {
      expect(node.path).toBe(filePathToUrlPath(node.file));
      expect(node.path).toBe(
        node.parentPath === null
          ? `/${node.slug}`
          : `${node.parentPath}/${node.slug}`,
      );
    }

    // Ordering: parents always precede their children.
    const seen = new Set<string>();
    for (const node of tree.ordered) {
      if (node.parentPath !== null) {
        expect(seen.has(node.parentPath)).toBe(true);
      }
      seen.add(node.path);
    }
  });
});
