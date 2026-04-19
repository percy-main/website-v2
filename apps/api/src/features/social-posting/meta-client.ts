import type { Config } from "../../config.ts";
import type { Platform } from "./schemas.ts";

export class MetaError extends Error {
  constructor(
    public stage: "facebook" | "instagram_container" | "instagram_publish",
    public status: number,
    public body: string,
  ) {
    super(`Meta ${stage} failed with HTTP ${status}: ${body}`);
    this.name = "MetaError";
  }
}

export interface PostArgs {
  caption: string;
  imageUrl: string;
}

export interface PostResult {
  externalPostId: string;
}

export interface MetaClient {
  postToFacebook: (args: PostArgs) => Promise<PostResult>;
  postToInstagram: (args: PostArgs) => Promise<PostResult>;
}

const BASE = "https://graph.facebook.com/v21.0";

export function createMetaClient(config: Config): MetaClient {
  async function postToFacebook(args: PostArgs): Promise<PostResult> {
    if (!config.META_FB_PAGE_ID || !config.META_FB_ACCESS_TOKEN) {
      throw new Error("Meta Facebook credentials not configured");
    }

    const params = new URLSearchParams({
      url: args.imageUrl,
      caption: args.caption,
      access_token: config.META_FB_ACCESS_TOKEN,
    });
    const res = await fetch(`${BASE}/${config.META_FB_PAGE_ID}/photos`, {
      method: "POST",
      body: params,
    });
    if (!res.ok) throw new MetaError("facebook", res.status, await res.text());
    const body = (await res.json()) as { id: string };
    return { externalPostId: body.id };
  }

  async function postToInstagram(args: PostArgs): Promise<PostResult> {
    if (!config.META_IG_USER_ID || !config.META_FB_ACCESS_TOKEN) {
      throw new Error("Meta Instagram credentials not configured");
    }

    const containerRes = await fetch(
      `${BASE}/${config.META_IG_USER_ID}/media`,
      {
        method: "POST",
        body: new URLSearchParams({
          image_url: args.imageUrl,
          caption: args.caption,
          access_token: config.META_FB_ACCESS_TOKEN,
        }),
      },
    );
    if (!containerRes.ok) {
      throw new MetaError(
        "instagram_container",
        containerRes.status,
        await containerRes.text(),
      );
    }
    const containerBody = (await containerRes.json()) as { id: string };

    const publishRes = await fetch(
      `${BASE}/${config.META_IG_USER_ID}/media_publish`,
      {
        method: "POST",
        body: new URLSearchParams({
          creation_id: containerBody.id,
          access_token: config.META_FB_ACCESS_TOKEN,
        }),
      },
    );
    if (!publishRes.ok) {
      throw new MetaError(
        "instagram_publish",
        publishRes.status,
        await publishRes.text(),
      );
    }
    const publishBody = (await publishRes.json()) as { id: string };
    return { externalPostId: publishBody.id };
  }

  return { postToFacebook, postToInstagram };
}

export function postFor(client: MetaClient, platform: Platform) {
  return platform === "facebook"
    ? client.postToFacebook.bind(client)
    : client.postToInstagram.bind(client);
}
