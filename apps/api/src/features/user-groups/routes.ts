import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireAuth,
  requirePermission,
} from "../auth/middleware.ts";
import {
  addGroupMemberResponseSchema,
  addGroupMemberSchema,
  createGroupResponseSchema,
  createGroupSchema,
  getGroupResponseSchema,
  groupIdParamSchema,
  groupMemberParamSchema,
  listGroupsResponseSchema,
  removeGroupMemberResponseSchema,
  searchUsersForGroupResponseSchema,
  searchUsersForGroupSchema,
} from "./schemas.ts";
import {
  addGroupMember,
  createGroup,
  getGroup,
  listGroups,
  removeGroupMember,
  searchUsersForGroup,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const userGroupsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Reuse `users:manage` — the same permission that gates Duplicates and
  // Record Linking sub-tabs. Groups are still emerging; a dedicated
  // permission pair can be added later if usage expands.
  const usersManage = requirePermission("users", "manage");

  const list = listGroups(app.db);
  const get = getGroup(app.db);
  const create = createGroup(app.db);
  const addMember = addGroupMember(app.db);
  const removeMember = removeGroupMember(app.db);
  const searchUsers = searchUsersForGroup(app.db);

  app.get(
    "/admin/user-groups",
    {
      preHandler: [requireAuth, usersManage],
      schema: { response: { 200: listGroupsResponseSchema } },
    },
    async () => {
      return await list();
    },
  );

  app.post(
    "/admin/user-groups",
    {
      preHandler: [requireAuth, usersManage],
      schema: {
        body: createGroupSchema,
        response: { 200: createGroupResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await create(user.id, request.body);
    },
  );

  app.get(
    "/admin/user-groups/:groupId",
    {
      preHandler: [requireAuth, usersManage],
      schema: {
        params: groupIdParamSchema,
        response: { 200: getGroupResponseSchema },
      },
    },
    async (request) => {
      return await get(request.params.groupId);
    },
  );

  app.post(
    "/admin/user-groups/:groupId/members",
    {
      preHandler: [requireAuth, usersManage],
      schema: {
        params: groupIdParamSchema,
        body: addGroupMemberSchema,
        response: { 200: addGroupMemberResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await addMember(request.params.groupId, request.body, user.id);
    },
  );

  app.delete(
    "/admin/user-groups/:groupId/members/:memberId",
    {
      preHandler: [requireAuth, usersManage],
      schema: {
        params: groupMemberParamSchema,
        response: { 200: removeGroupMemberResponseSchema },
      },
    },
    async (request) => {
      return await removeMember(
        request.params.groupId,
        request.params.memberId,
      );
    },
  );

  app.get(
    "/admin/user-groups/:groupId/search-users",
    {
      preHandler: [requireAuth, usersManage],
      schema: {
        params: groupIdParamSchema,
        querystring: searchUsersForGroupSchema,
        response: { 200: searchUsersForGroupResponseSchema },
      },
    },
    async (request) => {
      return await searchUsers(request.params.groupId, request.query);
    },
  );
};
