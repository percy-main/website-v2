import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/middleware.js";
import { parseBody, parseQuery } from "../../lib/validation.js";
import {
  sponsorshipListSchema,
  sponsorshipActionSchema,
  sponsorshipUpdateSchema,
  gameSponsorshipManualSchema,
  playerSponsorshipManualSchema,
  allApprovedSchema,
} from "./schemas.js";
import {
  getGameSponsorshipPrice,
  getPlayerSponsorshipPrice,
  getGameSponsorByGameId,
  getPlayerSponsorForPlayer,
  hasPlayerPendingSponsor,
  getAllApprovedPlayerSponsors,
  listGameSponsorships,
  listPlayerSponsorships,
  approveGameSponsorship,
  approvePlayerSponsorship,
  rejectGameSponsorship,
  rejectPlayerSponsorship,
  createManualGameSponsorship,
  createManualPlayerSponsorship,
  updateGameSponsorship,
  updatePlayerSponsorship,
} from "./service.js";

export const sponsorshipRoutes: FastifyPluginAsync = async (app) => {
  // --- Public routes ---

  app.get("/sponsorship/game/price", async () => {
    return getGameSponsorshipPrice();
  });

  app.get("/sponsorship/player/price", async () => {
    return getPlayerSponsorshipPrice();
  });

  app.get("/sponsorship/player/approved", async (request) => {
    const { season } = parseQuery(request, allApprovedSchema);
    const sponsors = await getAllApprovedPlayerSponsors(season);
    return { sponsors };
  });

  app.get<{ Params: { gameId: string } }>(
    "/sponsorship/game/:gameId",
    async (request) => {
      const { gameId } = request.params;
      const sponsor = await getGameSponsorByGameId(gameId);
      return { sponsor };
    },
  );

  app.get<{ Params: { contentfulEntryId: string } }>(
    "/sponsorship/player/:contentfulEntryId",
    async (request) => {
      const { contentfulEntryId } = request.params;
      const sponsor = await getPlayerSponsorForPlayer(contentfulEntryId);
      return { sponsor };
    },
  );

  app.get<{ Params: { contentfulEntryId: string } }>(
    "/sponsorship/player/:contentfulEntryId/pending",
    async (request) => {
      const { contentfulEntryId } = request.params;
      return hasPlayerPendingSponsor(contentfulEntryId);
    },
  );

  // --- Admin routes ---

  app.get(
    "/sponsorship/admin/game",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { page, pageSize, filter } = parseQuery(
        request,
        sponsorshipListSchema,
      );
      return listGameSponsorships(page, pageSize, filter);
    },
  );

  app.get(
    "/sponsorship/admin/player",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { page, pageSize, filter } = parseQuery(
        request,
        sponsorshipListSchema,
      );
      return listPlayerSponsorships(page, pageSize, filter);
    },
  );

  app.post(
    "/sponsorship/admin/game/approve",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseBody(request, sponsorshipActionSchema);
      return approveGameSponsorship(sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/game/reject",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseBody(request, sponsorshipActionSchema);
      return rejectGameSponsorship(sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/player/approve",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseBody(request, sponsorshipActionSchema);
      return approvePlayerSponsorship(sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/player/reject",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseBody(request, sponsorshipActionSchema);
      return rejectPlayerSponsorship(sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/game/manual",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const data = parseBody(request, gameSponsorshipManualSchema);
      return createManualGameSponsorship(data);
    },
  );

  app.post(
    "/sponsorship/admin/player/manual",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const data = parseBody(request, playerSponsorshipManualSchema);
      return createManualPlayerSponsorship(data);
    },
  );

  app.put<{ Params: { sponsorshipId: string } }>(
    "/sponsorship/admin/game/:sponsorshipId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = request.params;
      const data = parseBody(request, sponsorshipUpdateSchema);
      return updateGameSponsorship(sponsorshipId, data);
    },
  );

  app.put<{ Params: { sponsorshipId: string } }>(
    "/sponsorship/admin/player/:sponsorshipId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = request.params;
      const data = parseBody(request, sponsorshipUpdateSchema);
      return updatePlayerSponsorship(sponsorshipId, data);
    },
  );
};
