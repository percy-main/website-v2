import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { S3DocumentStore } from "../../lib/s3-documents.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
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

// In-memory S3 mock for integration tests
function createMockS3(): S3DocumentStore & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    uploadDocument({ documentId, version }) {
      const key = `documents/${documentId}/v${version}.pdf`;
      keys.push(key);
      return Promise.resolve(key);
    },
    getSignedDocumentUrl(s3Key: string) {
      return Promise.resolve(
        `https://mock-s3.example.com/${s3Key}?signed=true`,
      );
    },
  };
}

let ctx: TestContext;
let mockS3: ReturnType<typeof createMockS3>;

beforeAll(async () => {
  ctx = await startTestContainer();
  mockS3 = createMockS3();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("documents service (integration)", () => {
  it("creates a document and lists it", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });

    const result = await createDocument(
      ctx.db,
      mockS3,
    )({
      title: "Safeguarding Policy",
      pdfBytes: Buffer.from("fake-pdf"),
      createdBy: admin.userId,
    });

    expect(result.id).toBeDefined();
    expect(result.title).toBe("Safeguarding Policy");
    expect(result.version).toBe(1);

    const list = await listDocuments(ctx.db)();
    const found = list.documents.find((d) => d.id === result.id);
    expect(found).toEqual(
      expect.objectContaining({
        title: "Safeguarding Policy",
        assignedCount: 0,
      }),
    );
  });

  it("updates a document title without changing version", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });

    const doc = await createDocument(
      ctx.db,
      mockS3,
    )({
      title: "Old Title",
      pdfBytes: Buffer.from("fake-pdf"),
      createdBy: admin.userId,
    });

    const updated = await updateDocument(
      ctx.db,
      mockS3,
    )({
      documentId: doc.id,
      title: "New Title",
      updatedBy: admin.userId,
    });

    expect(updated.title).toBe("New Title");
    expect(updated.version).toBe(1); // no new PDF, no version bump
  });

  it("updates a document with new PDF and increments version", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });

    const doc = await createDocument(
      ctx.db,
      mockS3,
    )({
      title: "Policy",
      pdfBytes: Buffer.from("v1-pdf"),
      createdBy: admin.userId,
    });

    const updated = await updateDocument(
      ctx.db,
      mockS3,
    )({
      documentId: doc.id,
      pdfBytes: Buffer.from("v2-pdf"),
      updatedBy: admin.userId,
    });

    expect(updated.version).toBe(2);
  });

  it("assigns document to users and shows in detail", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const user1 = await seedTestUser(ctx.db);
    const user2 = await seedTestUser(ctx.db);

    const doc = await createDocument(
      ctx.db,
      mockS3,
    )({
      title: "Code of Conduct",
      pdfBytes: Buffer.from("fake-pdf"),
      createdBy: admin.userId,
    });

    const assignResult = await assignDocument(ctx.db)({
      documentId: doc.id,
      userIds: [user1.userId, user2.userId],
      assignedBy: admin.userId,
    });
    expect(assignResult.assigned).toBe(2);

    // Assigning again should skip duplicates
    const reassignResult = await assignDocument(ctx.db)({
      documentId: doc.id,
      userIds: [user1.userId],
      assignedBy: admin.userId,
    });
    expect(reassignResult.assigned).toBe(0);

    const detail = await getDocumentDetail(ctx.db)(doc.id);
    expect(detail.assignments).toHaveLength(2);
    expect(detail.assignments[0].confirmedAt).toBeNull();
  });

  it("member can view and confirm a document", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const user = await seedTestUser(ctx.db);

    const doc = await createDocument(
      ctx.db,
      mockS3,
    )({
      title: "Privacy Policy",
      pdfBytes: Buffer.from("fake-pdf"),
      createdBy: admin.userId,
    });

    await assignDocument(ctx.db)({
      documentId: doc.id,
      userIds: [user.userId],
      assignedBy: admin.userId,
    });

    // View document
    const viewResult = await viewDocument(ctx.db, mockS3)(doc.id, user.userId);
    expect(viewResult.title).toBe("Privacy Policy");
    expect(viewResult.signedUrl).toContain("mock-s3.example.com");
    expect(viewResult.confirmedAt).toBeNull();

    // Confirm document
    const confirmResult = await confirmDocument(ctx.db)(doc.id, user.userId);
    expect(confirmResult.confirmedVersion).toBe(1);

    // Check my documents shows as confirmed
    const myDocs = await getMyDocuments(ctx.db)(user.userId);
    const myDoc = myDocs.documents.find((d) => d.documentId === doc.id);
    expect(myDoc?.confirmedAt).toBeTruthy();
    expect(myDoc?.isOutdated).toBe(false);
  });

  it("flags confirmation as outdated after version bump", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const user = await seedTestUser(ctx.db);

    const doc = await createDocument(
      ctx.db,
      mockS3,
    )({
      title: "Anti-Doping Policy",
      pdfBytes: Buffer.from("v1"),
      createdBy: admin.userId,
    });

    await assignDocument(ctx.db)({
      documentId: doc.id,
      userIds: [user.userId],
      assignedBy: admin.userId,
    });

    // Confirm at v1
    await confirmDocument(ctx.db)(doc.id, user.userId);

    // Bump version
    await updateDocument(
      ctx.db,
      mockS3,
    )({
      documentId: doc.id,
      pdfBytes: Buffer.from("v2"),
      updatedBy: admin.userId,
    });

    // Check that confirmation is flagged as outdated
    const myDocs = await getMyDocuments(ctx.db)(user.userId);
    const myDoc = myDocs.documents.find((d) => d.documentId === doc.id);
    expect(myDoc).toEqual(
      expect.objectContaining({ confirmedVersion: 1, isOutdated: true }),
    );

    // Re-confirm at v2
    const reconfirm = await confirmDocument(ctx.db)(doc.id, user.userId);
    expect(reconfirm.confirmedVersion).toBe(2);

    const myDocsAfter = await getMyDocuments(ctx.db)(user.userId);
    const myDocAfter = myDocsAfter.documents.find(
      (d) => d.documentId === doc.id,
    );
    expect(myDocAfter).toEqual(expect.objectContaining({ isOutdated: false }));
  });

  it("unassigns a user from a document", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const user = await seedTestUser(ctx.db);

    const doc = await createDocument(
      ctx.db,
      mockS3,
    )({
      title: "To Be Removed",
      pdfBytes: Buffer.from("fake"),
      createdBy: admin.userId,
    });

    await assignDocument(ctx.db)({
      documentId: doc.id,
      userIds: [user.userId],
      assignedBy: admin.userId,
    });

    await unassignDocument(ctx.db)(doc.id, user.userId);

    const detail = await getDocumentDetail(ctx.db)(doc.id);
    expect(detail.assignments).toHaveLength(0);
  });

  it("archives a document and hides from member view", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const user = await seedTestUser(ctx.db);

    const doc = await createDocument(
      ctx.db,
      mockS3,
    )({
      title: "Old Policy",
      pdfBytes: Buffer.from("fake"),
      createdBy: admin.userId,
    });

    await assignDocument(ctx.db)({
      documentId: doc.id,
      userIds: [user.userId],
      assignedBy: admin.userId,
    });

    await archiveDocument(ctx.db)(doc.id);

    // Member should no longer see it
    const myDocs = await getMyDocuments(ctx.db)(user.userId);
    const found = myDocs.documents.find((d) => d.documentId === doc.id);
    expect(found).toBeUndefined();

    // Admin list still shows it (with archived flag)
    const list = await listDocuments(ctx.db)();
    const adminDoc = list.documents.find((d) => d.id === doc.id);
    expect(adminDoc?.archivedAt).toBeTruthy();
  });
});
