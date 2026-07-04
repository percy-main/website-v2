import { stripeConfig } from "@percy-main/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createPrerenderTrigger } from "../../lib/prerender-trigger.ts";
import { requirePermission } from "../auth/middleware.ts";
import { createStripe } from "../payments/stripe.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import {
  allApprovedSchema,
  approvedPlayerSponsorsResponseSchema,
  byGameIdSchema,
  bySlugSchema,
  gameSponsorResponseSchema,
  gameSponsorshipListResponseSchema,
  gameSponsorshipManualSchema,
  gameSponsorshipPaymentSchema,
  hasPendingResponseSchema,
  idResponseSchema,
  paymentResponseSchema,
  playerSponsorResponseSchema,
  playerSponsorshipListResponseSchema,
  playerSponsorshipManualSchema,
  playerSponsorshipPaymentSchema,
  priceResponseSchema,
  sponsorshipActionSchema,
  sponsorshipIdParamSchema,
  sponsorshipListSchema,
  sponsorshipUpdateSchema,
  successResponseSchema,
  takenSlugsResponseSchema,
} from "./schemas.ts";
import {
  approveGameSponsorship,
  approvePlayerSponsorship,
  createGameSponsorshipPayment,
  createManualGameSponsorship,
  createManualPlayerSponsorship,
  createPlayerSponsorshipPayment,
  getAllApprovedPlayerSponsors,
  getGameSponsorByGameId,
  getGameSponsorshipPrice,
  getPlayerSponsorForPlayer,
  getPlayerSponsorshipPrice,
  getTakenPlayerSponsorshipSlugs,
  hasGamePendingSponsor,
  hasPlayerPendingSponsor,
  listGameSponsorships,
  listPlayerSponsorships,
  rejectGameSponsorship,
  rejectPlayerSponsorship,
  updateGameSponsorship,
  updatePlayerSponsorship,
} from "./service.ts";

/** Parse dd/MM/yyyy + optional HH:mm into a Date, return null if invalid. */
function parseMatchDateTime(
  matchDate: string,
  matchTime: string | null,
): Date | null {
  if (!matchDate || !/^\d{2}\/\d{2}\/\d{4}$/.test(matchDate)) return null;
  const [dd, mm, yyyy] = matchDate.split("/");
  const iso = matchTime
    ? `${yyyy}-${mm}-${dd}T${matchTime}:00`
    : `${yyyy}-${mm}-${dd}T00:00:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const sponsorshipRoutes: FastifyPluginAsyncZod = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  // Approved+paid game sponsorships render on prerendered game pages;
  // any mutation that can change that fires a reconcile (fire-and-forget,
  // the 15-minute sweep is the backstop).
  const prerenderTrigger = createPrerenderTrigger(app.config, app.log);
  const prices =
    app.config.NODE_ENV === "production"
      ? stripeConfig.live.prices
      : stripeConfig.dev.prices;

  // Play Cricket API client for game validation
  const playCricketApi =
    app.config.PLAY_CRICKET_API_TOKEN && app.config.PLAY_CRICKET_SITE_ID
      ? createApiClient({
          apiToken: app.config.PLAY_CRICKET_API_TOKEN,
          siteId: app.config.PLAY_CRICKET_SITE_ID,
        })
      : null;

  const gameSponsor = getGameSponsorByGameId(app.db);
  const gamePending = hasGamePendingSponsor(app.db);
  const playerSponsor = getPlayerSponsorForPlayer(app.db);
  const playerPending = hasPlayerPendingSponsor(app.db);
  const allApproved = getAllApprovedPlayerSponsors(app.db);
  const takenSlugs = getTakenPlayerSponsorshipSlugs(app.db);
  const createGamePayment = createGameSponsorshipPayment(
    app.db,
    stripe,
    prices.sponsorship,
  );
  const createPayment = createPlayerSponsorshipPayment(
    app.db,
    stripe,
    prices.playerSponsorship,
  );
  const listGame = listGameSponsorships(app.db);
  const listPlayer = listPlayerSponsorships(app.db);
  const approveGame = approveGameSponsorship(app.db);
  const approvePlayer = approvePlayerSponsorship(app.db);
  const rejectGame = rejectGameSponsorship(app.db);
  const rejectPlayer = rejectPlayerSponsorship(app.db);
  const manualGame = createManualGameSponsorship(app.db);
  const manualPlayer = createManualPlayerSponsorship(app.db);
  const updateGame = updateGameSponsorship(app.db);
  const updatePlayer = updatePlayerSponsorship(app.db);

  // --- Public routes ---

  app.get(
    "/sponsorship/game/price",
    {
      schema: {
        response: { 200: priceResponseSchema },
      },
    },
    async () => {
      return await getGameSponsorshipPrice(stripe, prices.sponsorship);
    },
  );

  app.get(
    "/sponsorship/player/price",
    {
      schema: {
        response: { 200: priceResponseSchema },
      },
    },
    async () => {
      return await getPlayerSponsorshipPrice(stripe, prices.playerSponsorship);
    },
  );

  app.get(
    "/sponsorship/player/approved",
    {
      schema: {
        querystring: allApprovedSchema,
        response: { 200: approvedPlayerSponsorsResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      const sponsors = await allApproved(season);
      return { sponsors };
    },
  );

  app.get(
    "/sponsorship/game/:gameId",
    {
      schema: {
        params: byGameIdSchema,
        response: { 200: gameSponsorResponseSchema },
      },
    },
    async (request) => {
      const sponsor = await gameSponsor(request.params.gameId);
      return { sponsor };
    },
  );

  app.get(
    "/sponsorship/game/:gameId/pending",
    {
      schema: {
        params: byGameIdSchema,
        response: { 200: hasPendingResponseSchema },
      },
    },
    async (request) => {
      return await gamePending(request.params.gameId);
    },
  );

  app.post(
    "/sponsorship/game/create-payment",
    {
      schema: {
        body: gameSponsorshipPaymentSchema,
        response: { 200: paymentResponseSchema },
      },
    },
    async (request) => {
      const data = request.body;

      // Validate the game exists and is in the future
      if (playCricketApi) {
        const currentYear = new Date().getFullYear();
        const seasons = [currentYear, currentYear + 1];
        let found = false;

        for (const season of seasons) {
          const { matches } = await playCricketApi.getMatchesSummary(season);
          const match = matches.find((m) => String(m.id) === data.gameId);
          if (match) {
            const when = parseMatchDateTime(
              match.match_date,
              match.match_time ?? null,
            );
            if (!when || when <= new Date()) {
              throw Object.assign(
                new Error("This game is not available for sponsorship"),
                { statusCode: 400 },
              );
            }
            found = true;
            break;
          }
        }

        if (!found) {
          throw Object.assign(new Error("Game not found"), { statusCode: 404 });
        }
      }

      return await createGamePayment(data, request.log);
    },
  );

  app.get(
    "/sponsorship/player/:slug",
    {
      schema: {
        params: bySlugSchema,
        response: { 200: playerSponsorResponseSchema },
      },
    },
    async (request) => {
      const sponsor = await playerSponsor(request.params.slug);
      return { sponsor };
    },
  );

  app.get(
    "/sponsorship/player/:slug/pending",
    {
      schema: {
        params: bySlugSchema,
        response: { 200: hasPendingResponseSchema },
      },
    },
    async (request) => {
      return await playerPending(request.params.slug);
    },
  );

  app.post(
    "/sponsorship/player/create-payment",
    {
      schema: {
        body: playerSponsorshipPaymentSchema,
        response: { 200: paymentResponseSchema },
      },
    },
    async (request) => {
      return await createPayment(request.body, request.log);
    },
  );

  // --- Admin routes ---

  app.get(
    "/sponsorship/admin/game",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        querystring: sponsorshipListSchema,
        response: { 200: gameSponsorshipListResponseSchema },
      },
    },
    async (request) => {
      const { page, pageSize, filter } = request.query;
      return await listGame(page, pageSize, filter);
    },
  );

  app.get(
    "/sponsorship/admin/player",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        querystring: sponsorshipListSchema,
        response: { 200: playerSponsorshipListResponseSchema },
      },
    },
    async (request) => {
      const { page, pageSize, filter } = request.query;
      return await listPlayer(page, pageSize, filter);
    },
  );

  app.get(
    "/sponsorship/admin/player/taken-slugs",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        querystring: allApprovedSchema,
        response: { 200: takenSlugsResponseSchema },
      },
    },
    async (request) => {
      return await takenSlugs(request.query.season);
    },
  );

  app.post(
    "/sponsorship/admin/game/approve",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        body: sponsorshipActionSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const result = await approveGame(request.body.sponsorshipId);
      prerenderTrigger.reconcile();
      return result;
    },
  );

  app.post(
    "/sponsorship/admin/game/reject",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        body: sponsorshipActionSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const result = await rejectGame(request.body.sponsorshipId);
      prerenderTrigger.reconcile();
      return result;
    },
  );

  app.post(
    "/sponsorship/admin/player/approve",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        body: sponsorshipActionSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      return await approvePlayer(request.body.sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/player/reject",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        body: sponsorshipActionSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      return await rejectPlayer(request.body.sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/game/manual",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        body: gameSponsorshipManualSchema,
        response: { 200: idResponseSchema },
      },
    },
    async (request) => {
      const result = await manualGame(request.body);
      prerenderTrigger.reconcile();
      return result;
    },
  );

  app.post(
    "/sponsorship/admin/player/manual",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        body: playerSponsorshipManualSchema,
        response: { 200: idResponseSchema },
      },
    },
    async (request) => {
      return await manualPlayer(request.body);
    },
  );

  app.put(
    "/sponsorship/admin/game/:sponsorshipId",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        params: sponsorshipIdParamSchema,
        body: sponsorshipUpdateSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const result = await updateGame(
        request.params.sponsorshipId,
        request.body,
      );
      prerenderTrigger.reconcile();
      return result;
    },
  );

  app.put(
    "/sponsorship/admin/player/:sponsorshipId",
    {
      preHandler: [requirePermission("finance", "manage")],
      schema: {
        params: sponsorshipIdParamSchema,
        body: sponsorshipUpdateSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      return await updatePlayer(request.params.sponsorshipId, request.body);
    },
  );
};
