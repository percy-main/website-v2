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
  const gameSponsor = getGameSponsorByGameId(app.db);
  const playerSponsor = getPlayerSponsorForPlayer(app.db);
  const playerPending = hasPlayerPendingSponsor(app.db);
  const allApproved = getAllApprovedPlayerSponsors(app.db);
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

  app.get("/sponsorship/game/price", async () => {
    return getGameSponsorshipPrice();
  });

  app.get("/sponsorship/player/price", async () => {
    return getPlayerSponsorshipPrice();
  });

  app.get("/sponsorship/player/approved", async (request) => {
    const { season } = parseQuery(request, allApprovedSchema);
    const sponsors = await allApproved(season);
    return { sponsors };
  });

  app.get<{ Params: { gameId: string } }>(
    "/sponsorship/game/:gameId",
    async (request) => {
      const { gameId } = request.params;
      const sponsor = await gameSponsor(gameId);
      return { sponsor };
    },
  );

  app.get<{ Params: { contentfulEntryId: string } }>(
    "/sponsorship/player/:contentfulEntryId",
    async (request) => {
      const { contentfulEntryId } = request.params;
      const sponsor = await playerSponsor(contentfulEntryId);
      return { sponsor };
    },
  );

  app.get<{ Params: { contentfulEntryId: string } }>(
    "/sponsorship/player/:contentfulEntryId/pending",
    async (request) => {
      const { contentfulEntryId } = request.params;
      return playerPending(contentfulEntryId);
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
      return listGame(page, pageSize, filter);
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
      return listPlayer(page, pageSize, filter);
    },
  );

  app.post(
    "/sponsorship/admin/game/approve",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseBody(request, sponsorshipActionSchema);
      return approveGame(sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/game/reject",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseBody(request, sponsorshipActionSchema);
      return rejectGame(sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/player/approve",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseBody(request, sponsorshipActionSchema);
      return approvePlayer(sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/player/reject",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseBody(request, sponsorshipActionSchema);
      return rejectPlayer(sponsorshipId);
    },
  );

  app.post(
    "/sponsorship/admin/game/manual",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const data = parseBody(request, gameSponsorshipManualSchema);
      return manualGame(data);
    },
  );

  app.post(
    "/sponsorship/admin/player/manual",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const data = parseBody(request, playerSponsorshipManualSchema);
      return manualPlayer(data);
    },
  );

  app.put<{ Params: { sponsorshipId: string } }>(
    "/sponsorship/admin/game/:sponsorshipId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = request.params;
      const data = parseBody(request, sponsorshipUpdateSchema);
      return updateGame(sponsorshipId, data);
    },
  );

  app.put<{ Params: { sponsorshipId: string } }>(
    "/sponsorship/admin/player/:sponsorshipId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = request.params;
      const data = parseBody(request, sponsorshipUpdateSchema);
      return updatePlayer(sponsorshipId, data);
    },
  );
};
