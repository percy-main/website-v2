import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.ts";
import {
  getAuthSession,
  requireAuth,
  requireRole,
} from "../auth/middleware.ts";
import {
  assignPlayerSchema,
  createAvailabilityDateSchema,
  dateIdParamSchema,
  declareAvailabilitySchema,
  listAvailabilityDatesSchema,
  setAvailabilityForMemberSchema,
  unassignPlayerSchema,
} from "./schemas.ts";
import {
  assignPlayer,
  createAvailabilityDate,
  declareAvailability,
  deleteAvailabilityDate,
  getAvailabilityGrid,
  getEmailRecipients,
  getMyAvailability,
  listAvailabilityDates,
  setAvailabilityForMember,
  unassignPlayer,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const availabilityRoutes: FastifyPluginAsync = async (app) => {
  const officialRole = requireRole("official", "admin");

  // ── Official routes ──

  const createDate = createAvailabilityDate(app.db);
  const listDates = listAvailabilityDates(app.db);
  const deleteDate = deleteAvailabilityDate(app.db);
  const getGrid = getAvailabilityGrid(app.db);
  const setForMember = setAvailabilityForMember(app.db);
  const assign = assignPlayer(app.db);
  const unassign = unassignPlayer(app.db);
  const getRecipients = getEmailRecipients(app.db);

  // Create an availability date for a team
  app.post(
    "/availability/dates",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const data = parseBody(request, createAvailabilityDateSchema);
      return await createDate(user.id, role, data);
    },
  );

  // List availability dates for a team
  app.get(
    "/availability/dates",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const params = parseQuery(request, listAvailabilityDatesSchema);
      return await listDates(user.id, role, params);
    },
  );

  // Delete an availability date
  app.delete(
    "/availability/dates/:dateId",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      return await deleteDate(user.id, role, dateId);
    },
  );

  // Get the availability grid for a specific date
  app.get(
    "/availability/dates/:dateId/grid",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      return await getGrid(user.id, role, dateId);
    },
  );

  // Set availability on behalf of a member (official override)
  app.post(
    "/availability/dates/:dateId/set",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      const data = parseBody(request, setAvailabilityForMemberSchema);
      return await setForMember(user.id, role, dateId, data);
    },
  );

  // Assign a player to a matchday from the grid
  app.post(
    "/availability/dates/:dateId/assign",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      const data = parseBody(request, assignPlayerSchema);
      return await assign(user.id, role, dateId, data);
    },
  );

  // Unassign a player from a matchday
  app.post(
    "/availability/dates/:dateId/unassign",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      const data = parseBody(request, unassignPlayerSchema);
      return await unassign(user.id, role, dateId, data);
    },
  );

  // Get email recipients preview for an availability date
  app.get(
    "/availability/dates/:dateId/recipients",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      return await getRecipients(user.id, role, dateId);
    },
  );

  // ── Member routes ──

  const myAvailability = getMyAvailability(app.db);
  const declare = declareAvailability(app.db);

  // Get my availability declarations
  app.get(
    "/availability/me",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      return await myAvailability(user.id);
    },
  );

  // Declare availability for a date
  app.post(
    "/availability/dates/:dateId/declare",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { dateId } = parseParams(request, dateIdParamSchema);
      const data = parseBody(request, declareAvailabilitySchema);
      return await declare(user.id, dateId, data);
    },
  );
};
