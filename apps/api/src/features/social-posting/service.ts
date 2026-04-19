import type { DB } from "@percy-main/db";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { SocialMediaUploader } from "../../lib/s3-social-media.ts";
import { getTeamNewsData } from "../matchday/service.ts";
import { generateTeamNewsImage } from "../matchday/team-news-image.ts";
import { generateCaption, type LlmClient } from "./caption.ts";
import { MetaError, postFor, type MetaClient } from "./meta-client.ts";
import type { Platform, ReconcileBody } from "./schemas.ts";

export interface PublishDeps {
  db: Kysely<DB>;
  llm: LlmClient;
  meta: MetaClient;
  s3Social: SocialMediaUploader;
  slackWebhookUrl?: string;
  log: FastifyBaseLogger;
  enabled: boolean;
}

interface PublishInput {
  matchdayId: string;
  userId: string;
  role: string;
  isHome: boolean;
  matchTime: string | null;
}

export type PublishResult =
  | { skipped: "feature disabled" }
  | {
      facebook: PublishOneResult;
      instagram: PublishOneResult;
    };

export type PublishOneResult =
  | { state: "posted"; externalPostId: string }
  | { state: "failed"; error: string }
  | { state: "already_posted"; externalPostId: string }
  | { state: "in_flight" };

const PLATFORMS: Platform[] = ["facebook", "instagram"];

export function publishTeamSheet(deps: PublishDeps) {
  return async (input: PublishInput): Promise<PublishResult> => {
    if (!deps.enabled) return { skipped: "feature disabled" };

    const { db, log } = deps;

    const data = await getTeamNewsData(db)(
      input.userId,
      input.role,
      input.matchdayId,
      input.isHome,
      input.matchTime ?? undefined,
    );

    const captionResult = await generateCaption(deps.llm)(data);

    let image: Buffer;
    try {
      image = await generateTeamNewsImage(data);
    } catch (err) {
      log.error(
        { err, matchdayId: input.matchdayId },
        "Image generation failed",
      );
      await notifySlack(deps.slackWebhookUrl, {
        stage: "image",
        matchdayId: input.matchdayId,
        opposition: data.opposition,
        matchDate: data.matchDate,
        error: errorMessage(err),
      });
      throw err;
    }

    let imageUrl: string;
    try {
      imageUrl = await deps.s3Social.uploadTeamSheet({
        matchdayId: input.matchdayId,
        image,
      });
    } catch (err) {
      log.error({ err, matchdayId: input.matchdayId }, "S3 upload failed");
      await notifySlack(deps.slackWebhookUrl, {
        stage: "s3",
        matchdayId: input.matchdayId,
        opposition: data.opposition,
        matchDate: data.matchDate,
        error: errorMessage(err),
      });
      throw err;
    }

    const [facebook, instagram] = await Promise.all(
      PLATFORMS.map((platform) =>
        publishOne(deps, {
          matchdayId: input.matchdayId,
          opposition: data.opposition,
          matchDate: data.matchDate,
          platform,
          caption: captionResult.caption,
          captionSource: captionResult.source,
          captionVersion: captionResult.version,
          imageUrl,
        }),
      ),
    );

    return { facebook, instagram };
  };
}

interface PublishOneArgs {
  matchdayId: string;
  opposition: string;
  matchDate: string;
  platform: Platform;
  caption: string;
  captionSource: "ai" | "fallback";
  captionVersion: string;
  imageUrl: string;
}

async function publishOne(
  deps: PublishDeps,
  args: PublishOneArgs,
): Promise<PublishOneResult> {
  const { db, log } = deps;
  const claim = await claimPublication(db, args);

  if (claim.status === "already_posted") {
    log.info(
      {
        matchdayId: args.matchdayId,
        platform: args.platform,
        externalPostId: claim.externalPostId,
      },
      "Social post already published; skipping",
    );
    return { state: "already_posted", externalPostId: claim.externalPostId };
  }

  if (claim.status === "in_flight") {
    log.warn(
      { matchdayId: args.matchdayId, platform: args.platform },
      "Social post already in flight; skipping",
    );
    return { state: "in_flight" };
  }

  try {
    const { externalPostId } = await postFor(
      deps.meta,
      args.platform,
    )({ caption: args.caption, imageUrl: args.imageUrl });

    await recordSuccess(db, claim.id, claim.token, externalPostId);
    return { state: "posted", externalPostId };
  } catch (err) {
    const message = errorMessage(err);
    await recordFailure(db, claim.id, claim.token, message);

    log.error(
      {
        err,
        matchdayId: args.matchdayId,
        platform: args.platform,
        claim: claim.token,
      },
      "Social post failed",
    );
    await notifySlack(deps.slackWebhookUrl, {
      stage: args.platform,
      matchdayId: args.matchdayId,
      opposition: args.opposition,
      matchDate: args.matchDate,
      error:
        err instanceof MetaError
          ? `Meta ${err.stage} HTTP ${err.status}: ${err.body.slice(0, 400)}`
          : message,
      claim: claim.token,
    });

    return { state: "failed", error: message };
  }
}

type ClaimResult =
  | { status: "claimed"; id: string; token: string }
  | { status: "already_posted"; externalPostId: string }
  | { status: "in_flight" };

export async function claimPublication(
  db: Kysely<DB>,
  args: {
    matchdayId: string;
    platform: Platform;
    caption: string;
    captionSource: "ai" | "fallback";
    captionVersion: string;
    imageUrl: string;
  },
): Promise<ClaimResult> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();

  const result = await sql<{
    id: string;
    state: string;
    claim_token: string;
    external_post_id: string | null;
  }>`
    INSERT INTO matchday_social_publication
      (id, matchday_id, platform, state, claim_token,
       caption, caption_source, caption_prompt_version, image_url)
    VALUES (${id}, ${args.matchdayId}, ${args.platform}, 'claimed', ${token},
            ${args.caption}, ${args.captionSource},
            ${args.captionVersion}, ${args.imageUrl})
    ON CONFLICT (matchday_id, platform) DO UPDATE
      SET state = 'claimed',
          claim_token = EXCLUDED.claim_token,
          claimed_at = CURRENT_TIMESTAMP,
          caption = EXCLUDED.caption,
          caption_source = EXCLUDED.caption_source,
          caption_prompt_version = EXCLUDED.caption_prompt_version,
          image_url = EXCLUDED.image_url,
          last_error = NULL,
          attempt_count = matchday_social_publication.attempt_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE matchday_social_publication.state = 'failed'
        AND matchday_social_publication.external_post_id IS NULL
    RETURNING id, state, claim_token, external_post_id
  `.execute(db);

  if (result.rows.length === 0) {
    const existing = await db
      .selectFrom("matchday_social_publication")
      .where("matchday_id", "=", args.matchdayId)
      .where("platform", "=", args.platform)
      .select(["state", "external_post_id"])
      .executeTakeFirstOrThrow();

    if (existing.state === "posted" && existing.external_post_id) {
      return {
        status: "already_posted",
        externalPostId: existing.external_post_id,
      };
    }
    return { status: "in_flight" };
  }

  const row = result.rows[0];
  return { status: "claimed", id: row.id, token: row.claim_token };
}

async function recordSuccess(
  db: Kysely<DB>,
  id: string,
  token: string,
  externalPostId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .updateTable("matchday_social_publication")
    .set({
      state: "posted",
      external_post_id: externalPostId,
      posted_at: now,
      updated_at: now,
      last_error: null,
    })
    .where("id", "=", id)
    .where("claim_token", "=", token)
    .execute();
}

async function recordFailure(
  db: Kysely<DB>,
  id: string,
  token: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .updateTable("matchday_social_publication")
    .set({
      state: "failed",
      last_error: error,
      updated_at: now,
    })
    .where("id", "=", id)
    .where("claim_token", "=", token)
    .execute();
}

// ── Status / retry / reconcile ──

export function listPublications(db: Kysely<DB>) {
  return async (matchdayId: string) => {
    const items = await db
      .selectFrom("matchday_social_publication")
      .where("matchday_id", "=", matchdayId)
      .select([
        "id",
        "matchday_id",
        "platform",
        "state",
        "claimed_at",
        "posted_at",
        "external_post_id",
        "caption",
        "caption_source",
        "image_url",
        "last_error",
        "attempt_count",
        "updated_at",
      ])
      .orderBy("platform", "asc")
      .execute();

    return { items };
  };
}

export function retryPublication(deps: PublishDeps) {
  return async (input: {
    matchdayId: string;
    platform: Platform;
    userId: string;
    role: string;
    isHome: boolean;
    matchTime: string | null;
  }): Promise<PublishOneResult> => {
    if (!deps.enabled) return { state: "failed", error: "feature disabled" };

    const data = await getTeamNewsData(deps.db)(
      input.userId,
      input.role,
      input.matchdayId,
      input.isHome,
      input.matchTime ?? undefined,
    );

    const captionResult = await generateCaption(deps.llm)(data);
    const image = await generateTeamNewsImage(data);
    const imageUrl = await deps.s3Social.uploadTeamSheet({
      matchdayId: input.matchdayId,
      image,
    });

    return publishOne(deps, {
      matchdayId: input.matchdayId,
      opposition: data.opposition,
      matchDate: data.matchDate,
      platform: input.platform,
      caption: captionResult.caption,
      captionSource: captionResult.source,
      captionVersion: captionResult.version,
      imageUrl,
    });
  };
}

export function reconcilePublication(db: Kysely<DB>) {
  return async (
    input: {
      matchdayId: string;
      platform: Platform;
    } & ReconcileBody,
  ): Promise<{ state: "posted" | "failed" }> => {
    const row = await db
      .selectFrom("matchday_social_publication")
      .where("matchday_id", "=", input.matchdayId)
      .where("platform", "=", input.platform)
      .select(["id", "state", "external_post_id"])
      .executeTakeFirst();

    if (!row) {
      throw Object.assign(new Error("Publication row not found"), {
        statusCode: 404,
      });
    }

    if (row.state !== "claimed") {
      throw Object.assign(
        new Error(
          `Cannot reconcile row in state '${row.state}'. Only claimed rows are reconcilable.`,
        ),
        { statusCode: 400 },
      );
    }

    const now = new Date().toISOString();

    if (input.outcome === "posted") {
      await db
        .updateTable("matchday_social_publication")
        .set({
          state: "posted",
          external_post_id: input.externalPostId,
          posted_at: now,
          updated_at: now,
          last_error: null,
        })
        .where("id", "=", row.id)
        .execute();
      return { state: "posted" };
    }

    await db
      .updateTable("matchday_social_publication")
      .set({
        state: "failed",
        last_error: "reconciled as failed by operator",
        updated_at: now,
      })
      .where("id", "=", row.id)
      .execute();
    return { state: "failed" };
  };
}

// ── Helpers ──

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function notifySlack(
  webhookUrl: string | undefined,
  data: {
    stage: "image" | "s3" | "facebook" | "instagram";
    matchdayId: string;
    opposition: string;
    matchDate: string;
    error: string;
    claim?: string;
  },
): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text:
          `:rotating_light: Social posting failed\n` +
          `Fixture: ${data.matchdayId} vs ${data.opposition} on ${data.matchDate}\n` +
          `Stage: ${data.stage}\n` +
          (data.claim ? `Claim: ${data.claim}\n` : "") +
          `Error: ${data.error}`,
      }),
    });
  } catch {
    // Swallow — Slack failures must never break the publish flow
  }
}
