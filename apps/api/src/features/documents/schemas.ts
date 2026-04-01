import { z } from "zod";

// ── Shared param schemas ──

export const documentIdParamSchema = z.object({
  documentId: z.string().min(1),
});

export const assignmentParamSchema = z.object({
  documentId: z.string().min(1),
  userId: z.string().min(1),
});

// ── Admin: Create document ──

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(255),
  file: z.string().min(1), // base64 data URL (data:application/pdf;base64,...)
});

export const createDocumentResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number(),
});

// ── Admin: Update document ──

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  file: z.string().min(1).optional(), // new PDF replaces old, increments version
});

export const updateDocumentResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number(),
});

// ── Admin: List documents ──

export const listDocumentsResponseSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      version: z.number(),
      archivedAt: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
      assignedCount: z.number(),
      confirmedCount: z.number(),
    }),
  ),
});

// ── Admin: Get document detail ──

export const documentDetailResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number(),
  s3Key: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  assignments: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      userName: z.string().nullable(),
      userEmail: z.string(),
      assignedAt: z.string(),
      confirmedAt: z.string().nullable(),
      confirmedVersion: z.number().nullable(),
      isOutdated: z.boolean(),
    }),
  ),
});

// ── Admin: Assign document ──

export const assignDocumentSchema = z.object({
  userIds: z.array(z.string().min(1)).optional(),
  assignAllActive: z.boolean().optional(),
});

export const assignDocumentResponseSchema = z.object({
  assigned: z.number(),
});

// ── Admin: Unassign ──

export const unassignDocumentResponseSchema = z.object({
  success: z.boolean(),
});

// ── Admin: Archive ──

export const archiveDocumentResponseSchema = z.object({
  success: z.boolean(),
});

// ── Member: My documents ──

export const myDocumentsResponseSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string(),
      documentId: z.string(),
      title: z.string(),
      version: z.number(),
      assignedAt: z.string(),
      confirmedAt: z.string().nullable(),
      confirmedVersion: z.number().nullable(),
      isOutdated: z.boolean(),
    }),
  ),
});

// ── Member: View document (with signed URL) ──

export const viewDocumentResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number(),
  signedUrl: z.string(),
  confirmedAt: z.string().nullable(),
  confirmedVersion: z.number().nullable(),
  isOutdated: z.boolean(),
});

// ── Member: Confirm document ──

export const confirmDocumentResponseSchema = z.object({
  confirmedAt: z.string(),
  confirmedVersion: z.number(),
});
