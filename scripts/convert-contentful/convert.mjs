/**
 * Contentful → MDX converter
 *
 * Reads all content from the Contentful space and writes:
 *   - content/pages/ (hierarchical CMS pages as MDX)
 *   - content/news/ (news articles as MDX)
 *   - content/people/ (person profiles as MDX)
 *   - content/events/ (club events as MDX)
 *   - content/data/locations.yaml
 *   - content/data/sponsors.yaml
 *   - public/images/contentful/  (downloaded assets)
 *
 * Usage:
 *   cd scripts/convert-contentful
 *   npm install
 *   npm run convert
 *
 * Requires .env.contentful in the repo root with:
 *   CDN_SPACE_ID=...
 *   CDN_TOKEN=...
 *   CDN_ENVIRONMENT=...
 */

import { createClient } from "contentful";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

// ─── Config ──────────────────────────────────────────────────────────────────

const SPACE_ID = process.env.CDN_SPACE_ID;
const ACCESS_TOKEN = process.env.CDN_TOKEN;
const ENVIRONMENT = process.env.CDN_ENVIRONMENT || "master";

if (!SPACE_ID || !ACCESS_TOKEN) {
  console.error("Missing CDN_SPACE_ID or CDN_TOKEN in environment");
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTENT_DIR = path.join(ROOT, "apps/web/content");
const IMAGE_DIR = path.join(ROOT, "apps/web/public/images/contentful");

const client = createClient({
  space: SPACE_ID,
  accessToken: ACCESS_TOKEN,
  environment: ENVIRONMENT,
});

// ─── Contentful fetching ─────────────────────────────────────────────────────

async function fetchAll(contentType, include = 10) {
  const items = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const response = await client.getEntries({
      content_type: contentType,
      include,
      limit,
      skip,
    });
    items.push(...response.items);
    if (items.length >= response.total) break;
    skip += limit;
  }
  console.log(`  Fetched ${items.length} ${contentType} entries`);
  return items;
}

// ─── Image downloading ──────────────────────────────────────────────────────

const downloadedImages = new Map(); // url -> local path

async function downloadImage(url) {
  if (!url) return null;

  // Normalise URL
  const fullUrl = url.startsWith("//")
    ? `https:${url}`
    : url.startsWith("http")
      ? url
      : `https://${url}`;

  if (downloadedImages.has(fullUrl)) return downloadedImages.get(fullUrl);

  try {
    const urlObj = new URL(fullUrl);
    // Contentful URLs: //images.ctfassets.net/SPACE_ID/ASSET_ID/HASH/filename.ext
    const segments = urlObj.pathname.split("/").filter(Boolean);
    // Use last two segments as the local path to keep filenames unique
    const localName = segments.slice(-2).join("/");
    const localPath = path.join(IMAGE_DIR, localName);

    await mkdir(path.dirname(localPath), { recursive: true });

    if (!existsSync(localPath)) {
      const res = await fetch(fullUrl);
      if (!res.ok) {
        console.warn(`    Failed to download ${fullUrl}: ${res.status}`);
        return null;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFile(localPath, buffer);
      console.log(`    Downloaded: ${localName}`);
    }

    const webPath = `/images/contentful/${localName}`;
    downloadedImages.set(fullUrl, webPath);
    return webPath;
  } catch (err) {
    console.warn(`    Image download error for ${fullUrl}: ${err.message}`);
    return null;
  }
}

// ─── RichText → MDX conversion ──────────────────────────────────────────────

function richTextToMdx(document, indent = "") {
  if (!document || !document.content) return "";
  return document.content.map((node) => nodeToMdx(node, indent)).join("\n\n");
}

function nodeToMdx(node, indent = "") {
  switch (node.nodeType) {
    case "paragraph":
      return indent + inlineContent(node.content);

    case "heading-1":
      return indent + "# " + inlineContent(node.content);
    case "heading-2":
      return indent + "## " + inlineContent(node.content);
    case "heading-3":
      return indent + "### " + inlineContent(node.content);
    case "heading-4":
      return indent + "#### " + inlineContent(node.content);
    case "heading-5":
      return indent + "##### " + inlineContent(node.content);
    case "heading-6":
      return indent + "###### " + inlineContent(node.content);

    case "unordered-list":
      return node.content
        .map((item) => listItemToMdx(item, indent, "- "))
        .join("\n");

    case "ordered-list":
      return node.content
        .map((item, i) => listItemToMdx(item, indent, `${i + 1}. `))
        .join("\n");

    case "blockquote":
      return node.content
        .map((child) => nodeToMdx(child, indent + "> "))
        .join("\n>\n");

    case "hr":
      return indent + "---";

    case "embedded-entry-block":
      return indent + embeddedEntryToJsx(node.data?.target);

    case "embedded-asset-block":
      return indent + embeddedAssetToMdx(node.data?.target);

    case "table":
      return tableToMdx(node);

    default:
      // Unknown block types — try to render content if present
      if (node.content) {
        return node.content
          .map((child) => nodeToMdx(child, indent))
          .join("\n\n");
      }
      return "";
  }
}

function listItemToMdx(item, indent, prefix) {
  if (!item.content) return indent + prefix;

  const parts = item.content.map((child, i) => {
    if (child.nodeType === "paragraph") {
      return (
        (i === 0 ? indent + prefix : indent + "  ") +
        inlineContent(child.content)
      );
    }
    if (
      child.nodeType === "unordered-list" ||
      child.nodeType === "ordered-list"
    ) {
      return nodeToMdx(child, indent + "  ");
    }
    return nodeToMdx(child, indent + "  ");
  });

  return parts.join("\n");
}

function inlineContent(nodes) {
  if (!nodes) return "";
  return nodes.map(inlineNodeToMdx).join("");
}

function inlineNodeToMdx(node) {
  switch (node.nodeType) {
    case "text":
      return applyMarks(escapeForMdx(node.value), node.marks || []);

    case "hyperlink":
      return `[${inlineContent(node.content)}](${node.data?.uri || "#"})`;

    case "entry-hyperlink": {
      const target = node.data?.target;
      const slug = resolveEntrySlug(target);
      return `[${inlineContent(node.content)}](/${slug})`;
    }

    case "asset-hyperlink": {
      const asset = node.data?.target;
      const url = asset?.fields?.file?.url;
      const href = url ? (url.startsWith("//") ? `https:${url}` : url) : "#";
      return `[${inlineContent(node.content)}](${href})`;
    }

    case "embedded-entry-inline":
      return embeddedEntryToJsx(node.data?.target);

    default:
      if (node.content) return inlineContent(node.content);
      return "";
  }
}

function escapeForMdx(text) {
  if (!text) return "";
  // Escape characters that have meaning in MDX/markdown
  // but preserve intentional formatting
  return text
    .replace(/\\/g, "\\\\")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}");
}

function applyMarks(text, marks) {
  if (!text.trim()) return text; // Don't wrap whitespace-only

  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        text = `**${text}**`;
        break;
      case "italic":
        text = `*${text}*`;
        break;
      case "underline":
        text = `<u>${text}</u>`;
        break;
      case "code":
        text = `\`${text}\``;
        break;
      case "strikethrough":
        text = `~~${text}~~`;
        break;
      case "superscript":
        text = `<sup>${text}</sup>`;
        break;
      case "subscript":
        text = `<sub>${text}</sub>`;
        break;
    }
  }
  return text;
}

function resolveEntrySlug(entry) {
  if (!entry || !entry.fields) return "";
  return entry.fields.slug || entry.fields.name || entry.sys?.id || "";
}

// ─── Embedded entries → JSX ─────────────────────────────────────────────────

function embeddedEntryToJsx(target) {
  if (!target || !target.sys?.contentType?.sys?.id) {
    return "{/* unresolved embedded entry */}";
  }

  const contentType = target.sys.contentType.sys.id;
  const fields = target.fields || {};

  switch (contentType) {
    case "trustee":
      return `<Person slug="${fields.slug || ""}" />`;

    case "league":
      return `<LeagueTable divisionId="${fields.divisionId || ""}" name="${fields.name || ""}" />`;

    case "cricketLeaderboard": {
      const attrs = [`title="${fields.title || ""}"`];
      if (fields.season) attrs.push(`season="${fields.season}"`);
      if (fields.discipline) attrs.push(`discipline="${fields.discipline}"`);
      if (fields.category) attrs.push(`category="${fields.category}"`);
      if (fields.limit) attrs.push(`limit={${fields.limit}}`);
      return `<Leaderboard ${attrs.join(" ")} />`;
    }

    case "event":
      return `<EventPreview id="${target.sys.id}" />`;

    case "gameDetail":
      return `<GamePreview playCricketId="${fields.playCricketId || ""}" />`;

    case "emailCollector": {
      const attrs = [];
      if (fields.title) attrs.push(`title="${fields.title}"`);
      if (fields.description) attrs.push(`description="${fields.description}"`);
      if (fields.listId) attrs.push(`listId="${fields.listId}"`);
      return `<CollectEmail ${attrs.join(" ")} />`;
    }

    case "contactForm": {
      const attrs = [];
      if (fields.title) attrs.push(`title="${fields.title}"`);
      return `<ContactForm ${attrs.join(" ")} />`;
    }

    case "assetLink": {
      const asset = fields.asset;
      const href = fields.href || "#";
      if (asset?.fields?.file?.url) {
        const imgUrl = asset.fields.file.url.startsWith("//")
          ? `https:${asset.fields.file.url}`
          : asset.fields.file.url;
        return `[![${asset.fields.description || asset.fields.title || ""}](${imgUrl})](${href})`;
      }
      return `[Asset link](${href})`;
    }

    default:
      return `{/* unknown embedded entry: ${contentType} */}`;
  }
}

function embeddedAssetToMdx(asset) {
  if (!asset || !asset.fields?.file?.url) {
    return "{/* unresolved asset */}";
  }

  const url = asset.fields.file.url.startsWith("//")
    ? `https:${asset.fields.file.url}`
    : asset.fields.file.url;
  const alt = asset.fields.description || asset.fields.title || "";
  const title = asset.fields.title || "";

  // Check for nocaption tag
  const nocaption = asset.metadata?.tags?.some(
    (tag) => tag.sys?.id === "nocaption",
  );

  if (nocaption) {
    return `![${alt}](${url})`;
  }

  if (title || asset.fields.description) {
    return `<Image src="${url}" alt="${alt}" caption="${title}" />`;
  }

  return `![${alt}](${url})`;
}

function tableToMdx(node) {
  if (!node.content || node.content.length === 0) return "";

  const rows = node.content.map((row) =>
    row.content.map((cell) => {
      const text = cell.content
        ? cell.content.map((c) => nodeToMdx(c, "")).join(" ")
        : "";
      return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
    }),
  );

  if (rows.length === 0) return "";

  const header = `| ${rows[0].join(" | ")} |`;
  const separator = `| ${rows[0].map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(1)
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

  return [header, separator, body].filter(Boolean).join("\n");
}

// ─── YAML frontmatter helper ────────────────────────────────────────────────

function frontmatter(obj) {
  // Filter out undefined/null values
  const clean = Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null),
  );
  return `---\n${YAML.stringify(clean).trim()}\n---`;
}

// ─── Write helper ───────────────────────────────────────────────────────────

async function writeContent(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

// ─── Page converter ─────────────────────────────────────────────────────────

async function convertPages(pages) {
  console.log("\nConverting pages...");

  // Build parent→slug lookup for hierarchy
  const pageById = new Map();
  for (const page of pages) {
    pageById.set(page.sys.id, page);
  }

  // Resolve full slug path for a page
  function resolveSlugPath(page) {
    const parentRef = page.fields.parent;
    if (!parentRef) return page.fields.slug;

    // parentRef could be a resolved entry or an unresolved link
    const parent =
      parentRef.fields && parentRef.fields.slug
        ? parentRef
        : pageById.get(parentRef.sys?.id);

    if (!parent) return page.fields.slug;
    return resolveSlugPath(parent) + "/" + page.fields.slug;
  }

  for (const page of pages) {
    const slugPath = resolveSlugPath(page);
    const hasChildren = pages.some(
      (p) =>
        p.fields.parent &&
        (p.fields.parent.sys?.id === page.sys.id ||
          p.fields.parent.fields?.slug === page.fields.slug),
    );

    // Determine file path: if it has children, use _index.mdx in a directory
    const fileName = hasChildren
      ? path.join(CONTENT_DIR, "pages", slugPath, "_index.mdx")
      : path.join(CONTENT_DIR, "pages", slugPath + ".mdx");

    const fm = frontmatter({
      title: page.fields.title,
      menuOrder: page.fields.menuOrder ?? undefined,
      isMainMenu: page.fields.mainMenuItem || undefined,
      ldjson: page.fields.ldjson || undefined,
    });

    const body = richTextToMdx(page.fields.content);
    await writeContent(fileName, fm + "\n\n" + body + "\n");
    console.log(`  → ${path.relative(ROOT, fileName)}`);
  }
}

// ─── News converter ─────────────────────────────────────────────────────────

async function convertNews(newsItems) {
  console.log("\nConverting news...");

  for (const item of newsItems) {
    const date = new Date(item.sys.createdAt);
    const year = date.getFullYear();
    const slug = item.fields.slug;

    const author = item.fields.author;
    const authorSlug = author && author.fields ? author.fields.slug : undefined;

    // Extract page tags (pages field links to content pages used as categories)
    const tags = (item.fields.pages ?? [])
      .filter((page) => page && "fields" in page)
      .map((page) => page.fields.title);

    const fm = frontmatter({
      title: item.fields.title,
      date: date.toISOString().split("T")[0],
      author: authorSlug,
      slug: slug,
      tags: tags.length > 0 ? tags : undefined,
    });

    // Convert summary to plain text (first paragraph)
    const summary = item.fields.summary
      ? richTextToMdx(item.fields.summary)
      : "";
    const body = richTextToMdx(item.fields.content);

    const content =
      summary && summary.trim()
        ? fm + "\n\n" + body + "\n"
        : fm + "\n\n" + body + "\n";

    const fileName = path.join(
      CONTENT_DIR,
      "news",
      String(year),
      slug + ".mdx",
    );
    await writeContent(fileName, content);
    console.log(`  → ${path.relative(ROOT, fileName)}`);
  }
}

// ─── People converter ───────────────────────────────────────────────────────

async function convertPeople(people) {
  console.log("\nConverting people...");

  for (const person of people) {
    const fields = person.fields;
    const slug = fields.slug || person.sys.id;

    // Handle photo
    let photoPath = undefined;
    if (fields.photo?.fields?.file?.url) {
      photoPath = await downloadImage(fields.photo.fields.file.url);
    }

    const fm = frontmatter({
      name: fields.name,
      slug: slug,
      photo: photoPath || undefined,
      isDBSChecked: fields.dbsChecked || false,
      hasLeftClub: fields.hasLeftClub || false,
    });

    const bio = fields.bio ? richTextToMdx(fields.bio) : "";
    const fileName = path.join(CONTENT_DIR, "people", slug + ".mdx");
    await writeContent(fileName, fm + "\n\n" + bio + "\n");
    console.log(`  → ${path.relative(ROOT, fileName)}`);
  }
}

// ─── Events converter ───────────────────────────────────────────────────────

async function convertEvents(events, locations) {
  console.log("\nConverting events...");

  const locationById = new Map();
  for (const loc of locations) {
    locationById.set(loc.sys.id, loc);
  }

  for (const event of events) {
    const fields = event.fields;
    const slug =
      fields.name
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || event.sys.id;

    // Resolve location
    let locationName = undefined;
    if (fields.location) {
      const loc = fields.location.fields
        ? fields.location
        : locationById.get(fields.location.sys?.id);
      locationName = loc?.fields?.name;
    }

    const fm = frontmatter({
      name: fields.name,
      when: fields.when,
      finish: fields.finish || undefined,
      location: locationName || undefined,
    });

    const description = fields.description
      ? richTextToMdx(fields.description)
      : "";
    const fileName = path.join(CONTENT_DIR, "events", slug + ".mdx");
    await writeContent(fileName, fm + "\n\n" + description + "\n");
    console.log(`  → ${path.relative(ROOT, fileName)}`);
  }
}

// ─── Locations converter ────────────────────────────────────────────────────

async function convertLocations(locations) {
  console.log("\nConverting locations...");

  const data = locations.map((loc) => {
    const f = loc.fields;
    return {
      id: loc.sys.id,
      name: f.name || null,
      street: f.street || null,
      city: f.city || null,
      county: f.county || null,
      country: f.country || null,
      postcode: f.postcode || null,
      lat: f.coordinates?.lat || null,
      lon: f.coordinates?.lon || null,
    };
  });

  const fileName = path.join(CONTENT_DIR, "data", "locations.yaml");
  await writeContent(fileName, YAML.stringify(data));
  console.log(`  → ${path.relative(ROOT, fileName)} (${data.length} entries)`);
}

// ─── Sponsors converter ─────────────────────────────────────────────────────

async function convertSponsors(sponsors) {
  console.log("\nConverting sponsors...");

  const data = [];
  for (const sponsor of sponsors) {
    const f = sponsor.fields;

    let logoPath = undefined;
    if (f.logo?.fields?.file?.url) {
      logoPath = await downloadImage(f.logo.fields.file.url);
    }

    data.push({
      id: sponsor.sys.id,
      name: f.name,
      logo: logoPath || null,
    });
  }

  const fileName = path.join(CONTENT_DIR, "data", "sponsors.yaml");
  await writeContent(fileName, YAML.stringify(data));
  console.log(`  → ${path.relative(ROOT, fileName)} (${data.length} entries)`);
}

// ─── Image rewriting pass ───────────────────────────────────────────────────

/**
 * After all MDX files are written, do a pass to download Contentful images
 * referenced in markdown image syntax and rewrite the URLs to local paths.
 */
async function rewriteImages() {
  console.log("\nDownloading and rewriting images...");

  const { readdir, readFile } = await import("node:fs/promises");

  async function walkDir(dir) {
    const files = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await walkDir(full)));
        } else if (entry.name.endsWith(".mdx")) {
          files.push(full);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    return files;
  }

  const mdxFiles = await walkDir(CONTENT_DIR);
  const imgRegex =
    /!\[([^\]]*)\]\((https?:\/\/images\.ctfassets\.net\/[^)]+)\)/g;
  const srcRegex = /src="(https?:\/\/images\.ctfassets\.net\/[^"]+)"/g;

  for (const file of mdxFiles) {
    let content = await readFile(file, "utf-8");
    let changed = false;

    // Rewrite markdown images: ![alt](https://images.ctfassets.net/...)
    const mdMatches = [...content.matchAll(imgRegex)];
    for (const match of mdMatches) {
      const url = match[2];
      const localPath = await downloadImage(url);
      if (localPath) {
        content = content.replace(url, localPath);
        changed = true;
      }
    }

    // Rewrite JSX src attributes: src="https://images.ctfassets.net/..."
    const srcMatches = [...content.matchAll(srcRegex)];
    for (const match of srcMatches) {
      const url = match[1];
      const localPath = await downloadImage(url);
      if (localPath) {
        content = content.replace(url, localPath);
        changed = true;
      }
    }

    if (changed) {
      await writeFile(file, content, "utf-8");
    }
  }

  console.log(`  Downloaded ${downloadedImages.size} images total`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("Contentful → MDX Converter");
  console.log("==========================");
  console.log(`Space: ${SPACE_ID}`);
  console.log(`Environment: ${ENVIRONMENT}`);
  console.log(`Output: ${CONTENT_DIR}`);
  console.log();

  console.log("Fetching content from Contentful...");

  const [pages, news, people, events, locations, sponsors] = await Promise.all([
    fetchAll("page"),
    fetchAll("news"),
    fetchAll("trustee"),
    fetchAll("event"),
    fetchAll("location"),
    fetchAll("sponsor"),
  ]);

  // Remove test content pages (they'll be overwritten by real ones)
  const testPagesDir = path.join(CONTENT_DIR, "pages", "club");
  // Don't remove — let real content overwrite test files

  await convertPages(pages);
  await convertNews(news);
  await convertPeople(people);
  await convertEvents(events, locations);
  await convertLocations(locations);
  await convertSponsors(sponsors);

  // Download images and rewrite URLs in MDX files
  await rewriteImages();

  console.log("\n✓ Conversion complete!");
  console.log(
    `  Pages: ${pages.length}, News: ${news.length}, People: ${people.length}`,
  );
  console.log(
    `  Events: ${events.length}, Locations: ${locations.length}, Sponsors: ${sponsors.length}`,
  );
  console.log(`  Images downloaded: ${downloadedImages.size}`);
}

main().catch((err) => {
  console.error("Conversion failed:", err);
  process.exit(1);
});
