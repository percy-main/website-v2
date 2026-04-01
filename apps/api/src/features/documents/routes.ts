import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireRole,
  requireVerifiedEmail,
} from "../auth/middleware.ts";
import {
  archiveDocumentResponseSchema,
  assignDocumentResponseSchema,
  assignDocumentSchema,
  assignmentParamSchema,
  confirmDocumentResponseSchema,
  createDocumentResponseSchema,
  createDocumentSchema,
  documentDetailResponseSchema,
  documentIdParamSchema,
  listDocumentsResponseSchema,
  myDocumentsResponseSchema,
  unassignDocumentResponseSchema,
  updateDocumentResponseSchema,
  updateDocumentSchema,
  viewDocumentResponseSchema,
} from "./schemas.ts";
import {
  archiveDocument,
  assignDocument,
  confirmDocument,
  createDocument,
  getDocumentDetail,
  getMyDocuments,
  listDocuments,
  unassignDocument,
  updateDocument,
  viewDocument,
} from "./service.ts";

function parsePdfDataUrl(dataUrl: string): Buffer {
  const match = /^data:application\/pdf;base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw Object.assign(
      new Error("Invalid file format. Expected a base64-encoded PDF data URL."),
      { statusCode: 400 },
    );
  }
  return Buffer.from(match[1], "base64");
}

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const documentRoutes: FastifyPluginAsyncZod = async (app) => {
  // Curry services
  const create = createDocument(app.db, app.s3Documents);
  const update = updateDocument(app.db, app.s3Documents);
  const list = listDocuments(app.db);
  const detail = getDocumentDetail(app.db);
  const assign = assignDocument(app.db);
  const unassign = unassignDocument(app.db);
  const archive = archiveDocument(app.db);
  const myDocs = getMyDocuments(app.db);
  const view = viewDocument(app.db, app.s3Documents);
  const confirm = confirmDocument(app.db);

  // ── Admin endpoints ──

  app.post(
    "/admin/documents",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: createDocumentSchema,
        response: { 200: createDocumentResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const pdfBytes = parsePdfDataUrl(request.body.file);
      return await create({
        title: request.body.title,
        pdfBytes,
        createdBy: user.id,
      });
    },
  );

  app.put(
    "/admin/documents/:documentId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: documentIdParamSchema,
        body: updateDocumentSchema,
        response: { 200: updateDocumentResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const pdfBytes = request.body.file
        ? parsePdfDataUrl(request.body.file)
        : undefined;
      return await update({
        documentId: request.params.documentId,
        title: request.body.title,
        pdfBytes,
        updatedBy: user.id,
      });
    },
  );

  app.get(
    "/admin/documents",
    {
      preHandler: [requireRole("admin")],
      schema: {
        response: { 200: listDocumentsResponseSchema },
      },
    },
    async () => {
      return await list();
    },
  );

  app.get(
    "/admin/documents/:documentId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: documentIdParamSchema,
        response: { 200: documentDetailResponseSchema },
      },
    },
    async (request) => {
      return await detail(request.params.documentId);
    },
  );

  app.post(
    "/admin/documents/:documentId/assign",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: documentIdParamSchema,
        body: assignDocumentSchema,
        response: { 200: assignDocumentResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await assign({
        documentId: request.params.documentId,
        userIds: request.body.userIds,
        assignAllActive: request.body.assignAllActive,
        assignedBy: user.id,
      });
    },
  );

  app.delete(
    "/admin/documents/:documentId/assign/:userId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: assignmentParamSchema,
        response: { 200: unassignDocumentResponseSchema },
      },
    },
    async (request) => {
      return await unassign(request.params.documentId, request.params.userId);
    },
  );

  app.post(
    "/admin/documents/:documentId/archive",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: documentIdParamSchema,
        response: { 200: archiveDocumentResponseSchema },
      },
    },
    async (request) => {
      return await archive(request.params.documentId);
    },
  );

  // ── Member endpoints ──

  app.get(
    "/documents",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        response: { 200: myDocumentsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await myDocs(user.id);
    },
  );

  app.get(
    "/documents/:documentId",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        params: documentIdParamSchema,
        response: { 200: viewDocumentResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await view(request.params.documentId, user.id);
    },
  );

  app.post(
    "/documents/:documentId/confirm",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        params: documentIdParamSchema,
        response: { 200: confirmDocumentResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await confirm(request.params.documentId, user.id);
    },
  );
};
