import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.ts";
import { requireRole } from "../auth/middleware.ts";
import {
  allApprovedSchema,
  byGameIdSchema,
  bySlugSchema,
  gameSponsorshipManualSchema,
  playerSponsorshipManualSchema,
  sponsorshipActionSchema,
  sponsorshipIdParamSchema,
  sponsorshipListSchema,
  sponsorshipUpdateSchema,
} from "./schemas.ts";
import {
  approveGameSponsorship,
  approvePlayerSponsorship,
  createManualGameSponsorship,
  createManualPlayerSponsorship,
  getAllApprovedPlayerSponsors,
  getGameSponsorByGameId,
  getGameSponsorshipPrice,
  getPlayerSponsorForPlayer,
  getPlayerSponsorshipPrice,
  hasPlayerPendingSponsor,
  listGameSponsorships,
  listPlayerSponsorships,
  rejectGameSponsorship,
  rejectPlayerSponsorship,
  updateGameSponsorship,
  updatePlayerSponsorship,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
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

  app.get("/sponsorship/game/price", () => {
    return getGameSponsorshipPrice();
  });

  app.get("/sponsorship/player/price", () => {
    return getPlayerSponsorshipPrice();
  });

  app.get("/sponsorship/player/approved", async (request) => {
    const { season } = parseQuery(request, allApprovedSchema);
    const sponsors = await allApproved(season);
    return { sponsors };
  });

  app.get("/sponsorship/game/:gameId", async (request) => {
    const { gameId } = parseParams(request, byGameIdSchema);
    const sponsor = await gameSponsor(gameId);
    return { sponsor };
  });

  app.get("/sponsorship/player/:slug", async (request) => {
    const { slug } = parseParams(request, bySlugSchema);
    const sponsor = await playerSponsor(slug);
    return { sponsor };
  });

  app.get("/sponsorship/player/:slug/pending", async (request) => {
    const { slug } = parseParams(request, bySlugSchema);
    return await playerPending(slug);
  });

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

  app.put(
    "/sponsorship/admin/game/:sponsorshipId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseParams(request, sponsorshipIdParamSchema);
      const data = parseBody(request, sponsorshipUpdateSchema);
      return updateGame(sponsorshipId, data);
    },
  );

  app.put(
    "/sponsorship/admin/player/:sponsorshipId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { sponsorshipId } = parseParams(request, sponsorshipIdParamSchema);
      const data = parseBody(request, sponsorshipUpdateSchema);
      return updatePlayer(sponsorshipId, data);
    },
  );
};
