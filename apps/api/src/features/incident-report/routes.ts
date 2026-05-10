import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireRole } from "../auth/middleware.ts";
import {
  incidentReportAdminUpdateSchema,
  incidentReportDetailSchema,
  incidentReportIdParamSchema,
  incidentReportSubmissionResponseSchema,
  incidentReportSubmissionSchema,
  listIncidentReportsResponseSchema,
  listIncidentReportsSchema,
  successResponseSchema,
} from "./schemas.ts";
import {
  createIncidentReportSubmission,
  getIncidentReport,
  listIncidentReports,
  updateIncidentReport,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const incidentReportRoutes: FastifyPluginAsyncZod = async (app) => {
  const submit = createIncidentReportSubmission(app.db, {
    slackWebhookUrl: app.config.SLACK_WEBHOOK_URL,
    baseUrl: app.config.BASE_URL,
    send: app.send,
  });
  const list = listIncidentReports(app.db);
  const get = getIncidentReport(app.db);
  const update = updateIncidentReport(app.db);

  // --- Public ---

  app.post(
    "/incident-report",
    {
      schema: {
        body: incidentReportSubmissionSchema,
        response: { 200: incidentReportSubmissionResponseSchema },
      },
    },
    async (request) => {
      return await submit(request.body, request.log);
    },
  );

  // --- Admin ---

  app.get(
    "/admin/incident-reports",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listIncidentReportsSchema,
        response: { 200: listIncidentReportsResponseSchema },
      },
    },
    async (request) => {
      return await list(request.query);
    },
  );

  app.get(
    "/admin/incident-reports/:id",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: incidentReportIdParamSchema,
        response: { 200: incidentReportDetailSchema },
      },
    },
    async (request) => {
      const report = await get(request.params.id);
      if (!report) {
        throw Object.assign(new Error("Incident report not found"), {
          statusCode: 404,
        });
      }
      return report;
    },
  );

  app.patch(
    "/admin/incident-reports/:id",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: incidentReportIdParamSchema,
        body: incidentReportAdminUpdateSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      return await update(request.params.id, request.body);
    },
  );
};
