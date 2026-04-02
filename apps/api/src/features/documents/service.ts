import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type { S3DocumentStore } from "../../lib/s3-documents.ts";

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

// ── Admin: Create document (after browser upload to pending bucket) ──

export function createDocument(db: Kysely<DB>, s3: S3DocumentStore) {
  return async (params: {
    title: string;
    pendingKey: string;
    createdBy: string;
  }) => {
    const id = crypto.randomUUID();
    const version = 1;
    const now = new Date().toISOString();

    // Copy from pending uploads bucket to permanent documents bucket
    const s3Key = await s3.copyToPermanent(params.pendingKey, id, version);

    const initialHistory = [
      {
        version,
        title: params.title,
        s3Key,
        createdBy: params.createdBy,
        createdAt: now,
      },
    ];

    await db
      .insertInto("document")
      .values({
        id,
        title: params.title,
        s3_key: s3Key,
        version,
        created_by: params.createdBy,
        updated_by: params.createdBy,
        history: JSON.stringify(initialHistory),
      })
      .execute();

    return { id, title: params.title, version };
  };
}

// ── Admin: Update document ──

export function updateDocument(db: Kysely<DB>, s3: S3DocumentStore) {
  return async (params: {
    documentId: string;
    title?: string;
    pendingKey?: string; // new PDF in pending bucket → version bump + copy
    expectedVersion: number;
    updatedBy: string;
  }) => {
    // S3 copy happens outside the transaction (idempotent, no rollback needed)
    let newS3Key: string | undefined;
    let newVersion: number | undefined;

    if (params.pendingKey) {
      // Pre-fetch current version to compute next version for the S3 key
      const current = await db
        .selectFrom("document")
        .where("id", "=", params.documentId)
        .where("archived_at", "is", null)
        .select("version")
        .executeTakeFirst();

      if (!current) {
        throwHttpError(404, "Document not found");
      }

      newVersion = current.version + 1;
      newS3Key = await s3.copyToPermanent(
        params.pendingKey,
        params.documentId,
        newVersion,
      );
    }

    // Read + snapshot history + update in a transaction
    return await db.transaction().execute(async (tx) => {
      const doc = await tx
        .selectFrom("document")
        .where("id", "=", params.documentId)
        .where("archived_at", "is", null)
        .select([
          "id",
          "title",
          "version",
          "s3_key",
          "history",
          "updated_by",
          "updated_at",
        ])
        .executeTakeFirst();

      if (!doc) {
        throwHttpError(404, "Document not found");
      }

      if (doc.version !== params.expectedVersion) {
        throwHttpError(
          409,
          `Version conflict: expected v${params.expectedVersion} but document is at v${doc.version}`,
        );
      }

      const finalVersion = newVersion ?? doc.version;
      const finalS3Key = newS3Key ?? doc.s3_key;
      const finalTitle = params.title ?? doc.title;
      const now = new Date().toISOString();

      // Append new state to history
      const history = (Array.isArray(doc.history) ? doc.history : []) as Array<{
        version: number;
        title: string;
        s3Key: string;
        createdBy: string;
        createdAt: string;
      }>;
      history.push({
        version: finalVersion,
        title: finalTitle,
        s3Key: finalS3Key,
        createdBy: params.updatedBy,
        createdAt: now,
      });

      await tx
        .updateTable("document")
        .set({
          title: finalTitle,
          version: finalVersion,
          s3_key: finalS3Key,
          updated_by: params.updatedBy,
          updated_at: now,
          history: JSON.stringify(history),
        })
        .where("id", "=", doc.id)
        .execute();

      return { id: doc.id, title: finalTitle, version: finalVersion };
    });
  };
}

// ── Admin: List documents ──

export function listDocuments(db: Kysely<DB>) {
  return async () => {
    const rows = await db
      .selectFrom("document as d")
      .leftJoin("document_assignment as da", "da.document_id", "d.id")
      .select([
        "d.id",
        "d.title",
        "d.version",
        "d.archived_at",
        "d.created_at",
        "d.updated_at",
      ])
      .select((eb) => [
        eb.fn
          .countAll<string>()
          .filterWhere("da.id", "is not", null)
          .as("assigned_count"),
        eb.fn
          .countAll<string>()
          .filterWhere("da.confirmed_at", "is not", null)
          .as("confirmed_count"),
      ])
      .groupBy("d.id")
      .orderBy("d.created_at", "desc")
      .execute();

    return {
      documents: rows.map((r) => ({
        id: r.id,
        title: r.title,
        version: r.version,
        archivedAt: r.archived_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        assignedCount: Number(r.assigned_count),
        confirmedCount: Number(r.confirmed_count),
      })),
    };
  };
}

// ── Admin: Get document detail with assignments ──

export function getDocumentDetail(db: Kysely<DB>) {
  return async (documentId: string) => {
    const doc = await db
      .selectFrom("document")
      .where("id", "=", documentId)
      .select([
        "id",
        "title",
        "version",
        "archived_at",
        "created_at",
        "updated_at",
        "history",
      ])
      .executeTakeFirst();

    if (!doc) {
      throwHttpError(404, "Document not found");
    }

    const history = (Array.isArray(doc.history) ? doc.history : []) as Array<{
      version: number;
      title: string;
      s3Key: string;
      createdBy: string;
      createdAt: string;
    }>;

    const assignments = await db
      .selectFrom("document_assignment as da")
      .innerJoin("user", "user.id", "da.user_id")
      .where("da.document_id", "=", documentId)
      .select([
        "da.id",
        "da.user_id",
        "user.name as user_name",
        "user.email as user_email",
        "da.assigned_at",
        "da.confirmed_at",
        "da.confirmed_version",
      ])
      .orderBy("user.name")
      .execute();

    return {
      id: doc.id,
      title: doc.title,
      version: doc.version,
      archivedAt: doc.archived_at,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      history: history.map((h) => ({
        version: h.version,
        title: h.title,
        createdBy: h.createdBy,
        createdAt: h.createdAt,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        userId: a.user_id,
        userName: a.user_name,
        userEmail: a.user_email,
        assignedAt: a.assigned_at,
        confirmedAt: a.confirmed_at,
        confirmedVersion: a.confirmed_version,
        isOutdated:
          a.confirmed_version !== null && a.confirmed_version < doc.version,
      })),
    };
  };
}

// ── Admin: Assign document to users ──

export function assignDocument(db: Kysely<DB>) {
  return async (params: {
    documentId: string;
    userIds?: string[];
    assignAllActive?: boolean;
    assignedBy: string;
  }) => {
    // Verify document exists and is not archived
    const doc = await db
      .selectFrom("document")
      .where("id", "=", params.documentId)
      .where("archived_at", "is", null)
      .select("id")
      .executeTakeFirst();

    if (!doc) {
      throwHttpError(404, "Document not found");
    }

    let targetUserIds: string[];

    if (params.assignAllActive) {
      // Get all active members with user accounts
      const users = await db
        .selectFrom("member as m")
        .innerJoin("user as u", "u.email", "m.email")
        .where("m.deleted_at", "is", null)
        .select("u.id")
        .execute();
      targetUserIds = users.map((u) => u.id);
    } else {
      targetUserIds = params.userIds ?? [];
    }

    if (targetUserIds.length === 0) {
      return { assigned: 0 };
    }

    // Get existing assignments to skip duplicates
    const existing = await db
      .selectFrom("document_assignment")
      .where("document_id", "=", params.documentId)
      .where("user_id", "in", targetUserIds)
      .select("user_id")
      .execute();

    const existingIds = new Set(existing.map((e) => e.user_id));
    const newUserIds = targetUserIds.filter((id) => !existingIds.has(id));

    if (newUserIds.length === 0) {
      return { assigned: 0 };
    }

    await db
      .insertInto("document_assignment")
      .values(
        newUserIds.map((userId) => ({
          id: crypto.randomUUID(),
          document_id: params.documentId,
          user_id: userId,
          assigned_by: params.assignedBy,
        })),
      )
      .execute();

    return { assigned: newUserIds.length };
  };
}

// ── Admin: Unassign document from user ──

export function unassignDocument(db: Kysely<DB>) {
  return async (documentId: string, userId: string) => {
    await db
      .deleteFrom("document_assignment")
      .where("document_id", "=", documentId)
      .where("user_id", "=", userId)
      .execute();

    return { success: true };
  };
}

// ── Admin: Archive document ──

export function archiveDocument(db: Kysely<DB>) {
  return async (documentId: string) => {
    const result = await db
      .updateTable("document")
      .set({ archived_at: new Date().toISOString() })
      .where("id", "=", documentId)
      .where("archived_at", "is", null)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      throwHttpError(404, "Document not found or already archived");
    }

    return { success: true };
  };
}

// ── Member: Get my assigned documents ──

export function getMyDocuments(db: Kysely<DB>) {
  return async (userId: string) => {
    const rows = await db
      .selectFrom("document_assignment as da")
      .innerJoin("document as d", "d.id", "da.document_id")
      .where("da.user_id", "=", userId)
      .where("d.archived_at", "is", null)
      .select([
        "da.id",
        "da.document_id",
        "d.title",
        "d.version",
        "da.assigned_at",
        "da.confirmed_at",
        "da.confirmed_version",
      ])
      .orderBy("da.assigned_at", "desc")
      .execute();

    return {
      documents: rows.map((r) => ({
        id: r.id,
        documentId: r.document_id,
        title: r.title,
        version: r.version,
        assignedAt: r.assigned_at,
        confirmedAt: r.confirmed_at,
        confirmedVersion: r.confirmed_version,
        isOutdated:
          r.confirmed_version !== null && r.confirmed_version < r.version,
      })),
    };
  };
}

// ── Member: View document (metadata + signed URL) ──

export function viewDocument(db: Kysely<DB>, s3: S3DocumentStore) {
  return async (documentId: string, userId: string) => {
    const row = await db
      .selectFrom("document_assignment as da")
      .innerJoin("document as d", "d.id", "da.document_id")
      .where("da.document_id", "=", documentId)
      .where("da.user_id", "=", userId)
      .where("d.archived_at", "is", null)
      .select([
        "d.id",
        "d.title",
        "d.version",
        "d.s3_key",
        "da.confirmed_at",
        "da.confirmed_version",
      ])
      .executeTakeFirst();

    if (!row) {
      throwHttpError(404, "Document not found or not assigned");
    }

    const signedUrl = await s3.getSignedDocumentUrl(row.s3_key);

    return {
      id: row.id,
      title: row.title,
      version: row.version,
      signedUrl,
      confirmedAt: row.confirmed_at,
      confirmedVersion: row.confirmed_version,
      isOutdated:
        row.confirmed_version !== null && row.confirmed_version < row.version,
    };
  };
}

// ── Member: Confirm document ──

export function confirmDocument(db: Kysely<DB>) {
  return async (documentId: string, userId: string) => {
    // Get the current document version
    const doc = await db
      .selectFrom("document")
      .where("id", "=", documentId)
      .where("archived_at", "is", null)
      .select(["id", "version"])
      .executeTakeFirst();

    if (!doc) {
      throwHttpError(404, "Document not found");
    }

    // Verify user is assigned
    const assignment = await db
      .selectFrom("document_assignment")
      .where("document_id", "=", documentId)
      .where("user_id", "=", userId)
      .select("id")
      .executeTakeFirst();

    if (!assignment) {
      throwHttpError(403, "Document not assigned to you");
    }

    const confirmedAt = new Date().toISOString();

    await db
      .updateTable("document_assignment")
      .set({
        confirmed_at: confirmedAt,
        confirmed_version: doc.version,
      })
      .where("id", "=", assignment.id)
      .execute();

    return { confirmedAt, confirmedVersion: doc.version };
  };
}
