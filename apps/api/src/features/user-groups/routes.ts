import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireAuth,
  requirePermission,
} from "../auth/middleware.ts";
import {
  addGroupMembersResponseSchema,
  addGroupMembersSchema,
  availableMembersResponseSchema,
  createGroupResponseSchema,
  createGroupSchema,
  getGroupResponseSchema,
  groupIdParamSchema,
  groupMemberParamSchema,
  listGroupsResponseSchema,
  removeGroupMemberResponseSchema,
} from "./schemas.ts";
import {
  addGroupMembers,
  createGroup,
  getGroup,
  listAvailableMembers,
  listGroups,
  removeGroupMember,
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
  const addMembers = addGroupMembers(app.db);
  const removeMember = removeGroupMember(app.db);
  const available = listAvailableMembers(app.db);

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
        body: addGroupMembersSchema,
        response: { 200: addGroupMembersResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await addMembers(request.params.groupId, request.body, user.id);
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
    "/admin/user-groups/:groupId/available-members",
    {
      preHandler: [requireAuth, usersManage],
      schema: {
        params: groupIdParamSchema,
        response: { 200: availableMembersResponseSchema },
      },
    },
    async (request) => {
      return await available(request.params.groupId);
    },
  );
};
