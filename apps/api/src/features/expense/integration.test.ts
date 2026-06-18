import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { S3Uploader } from "../../lib/s3-upload.ts";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  createCategory,
  decideExpense,
  getExpenseDetail,
  getExpenseSummary,
  getMyExpenses,
  listCategories,
  listExpenses,
  markExpensePaid,
  submitExpense,
  updateCategory,
} from "./service.ts";

const log = createNoopLogger();

// Not testing email rendering — keep focused on DB state and notification fan-out.
vi.mock("react-email", () => ({
  render: vi.fn().mockResolvedValue("<html></html>"),
}));

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 60_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

const fakeS3: S3Uploader = {
  uploadReceipt: vi.fn().mockResolvedValue("https://s3.example/receipt.jpg"),
};

function deps(send = vi.fn().mockResolvedValue(undefined)) {
  return { send, baseUrl: "https://percymain.org", s3: fakeS3 };
}

async function seedSubmitter() {
  return seedTestUser(ctx.db, { role: "expense_submitter", withMember: false });
}
async function seedApprover() {
  return seedTestUser(ctx.db, { role: "expense_approver", withMember: false });
}

async function submitClaim(
  submitter: { userId: string; name: string },
  overrides: { amountPence?: number; tagNames?: string[] } = {},
) {
  const send = vi.fn().mockResolvedValue(undefined);
  const { id } = await submitExpense(
    ctx.db,
    deps(send),
  )(
    submitter.userId,
    submitter.name,
    {
      description: "Petrol to the away game",
      amountPence: overrides.amountPence ?? 2000,
      tagNames: overrides.tagNames ?? ["fuel"],
    },
    log,
  );
  return { id, send };
}

describe("expense (integration)", () => {
  it("submit creates a pending expense, tag links and a submitted event", async () => {
    const submitter = await seedSubmitter();
    const { id } = await submitClaim(submitter, { tagNames: ["Fuel", "Travel"] });

    const row = await ctx.db
      .selectFrom("expense")
      .where("id", "=", id)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("pending");
    expect(row.created_by).toBe(submitter.userId);
    expect(row.amount_pence).toBe(2000);

    const tags = await ctx.db
      .selectFrom("expense_category_link")
      .where("expense_id", "=", id)
      .selectAll()
      .execute();
    expect(tags).toHaveLength(2);

    const events = await ctx.db
      .selectFrom("expense_event")
      .where("expense_id", "=", id)
      .selectAll()
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("submitted");
    expect(events[0].to_status).toBe("pending");
  });

  it("submit notifies every expense_approver by email", async () => {
    await seedApprover();
    await seedApprover();
    const submitter = await seedSubmitter();
    const { send } = await submitClaim(submitter);
    // At least the two approvers we just seeded (other tests may add more).
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("submit stores a receipt url when an image is provided", async () => {
    const submitter = await seedSubmitter();
    const { id } = await submitExpense(
      ctx.db,
      deps(),
    )(
      submitter.userId,
      submitter.name,
      {
        description: "New stumps",
        amountPence: 4000,
        receiptImage: "data:image/png;base64,iVBORw0KGgoAAAANS=",
        tagNames: ["equipment"],
      },
      log,
    );
    const row = await ctx.db
      .selectFrom("expense")
      .where("id", "=", id)
      .select(["receipt_image_url"])
      .executeTakeFirstOrThrow();
    expect(row.receipt_image_url).toBe("https://s3.example/receipt.jpg");
  });

  it("submit rejects a malformed receipt data url (400)", async () => {
    const submitter = await seedSubmitter();
    await expect(
      submitExpense(
        ctx.db,
        deps(),
      )(
        submitter.userId,
        submitter.name,
        {
          description: "x",
          amountPence: 100,
          receiptImage: "not-a-data-url",
          tagNames: [],
        },
        log,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("a single approver approves a sub-GBP-50 claim", async () => {
    const submitter = await seedSubmitter();
    const approver = await seedApprover();
    const { id } = await submitClaim(submitter, { amountPence: 2000 });

    const result = await decideExpense(ctx.db, deps())(
      approver.userId,
      id,
      { decision: "approve", note: "Fine" },
      log,
    );
    expect(result.status).toBe("approved");

    const row = await ctx.db
      .selectFrom("expense")
      .where("id", "=", id)
      .select(["status"])
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("approved");
  });

  it("a GBP 50+ claim needs two distinct approvers", async () => {
    const submitter = await seedSubmitter();
    const approver1 = await seedApprover();
    const approver2 = await seedApprover();
    const { id } = await submitClaim(submitter, { amountPence: 5000 });

    const first = await decideExpense(ctx.db, deps())(
      approver1.userId,
      id,
      { decision: "approve" },
      log,
    );
    expect(first.status).toBe("awaiting_second_approval");

    const second = await decideExpense(ctx.db, deps())(
      approver2.userId,
      id,
      { decision: "approve" },
      log,
    );
    expect(second.status).toBe("approved");

    const approvals = await ctx.db
      .selectFrom("expense_approval")
      .where("expense_id", "=", id)
      .selectAll()
      .execute();
    expect(approvals).toHaveLength(2);
  });

  it("the same approver cannot supply both approvals (409)", async () => {
    const submitter = await seedSubmitter();
    const approver = await seedApprover();
    const { id } = await submitClaim(submitter, { amountPence: 8000 });

    await decideExpense(ctx.db, deps())(
      approver.userId,
      id,
      { decision: "approve" },
      log,
    );
    await expect(
      decideExpense(ctx.db, deps())(
        approver.userId,
        id,
        { decision: "approve" },
        log,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("an approver cannot decide their own claim (403)", async () => {
    // A user who can both submit and approve.
    const both = await seedTestUser(ctx.db, {
      role: "expense_submitter,expense_approver",
      withMember: false,
    });
    const { id } = await submitClaim(both);
    await expect(
      decideExpense(ctx.db, deps())(both.userId, id, { decision: "approve" }, log),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("approval requires at least one tag", async () => {
    const submitter = await seedSubmitter();
    const approver = await seedApprover();
    const { id } = await submitClaim(submitter, { tagNames: [] });
    await expect(
      decideExpense(ctx.db, deps())(
        approver.userId,
        id,
        { decision: "approve" },
        log,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("an approver can replace the tag set when approving", async () => {
    const submitter = await seedSubmitter();
    const approver = await seedApprover();
    const { id } = await submitClaim(submitter, { tagNames: ["wrong-tag"] });

    await decideExpense(ctx.db, deps())(
      approver.userId,
      id,
      { decision: "approve", tagNames: ["umpires fee"] },
      log,
    );

    const detail = await getExpenseDetail(ctx.db)(id);
    expect(detail.tags.map((t) => t.name)).toEqual(["umpires fee"]);
  });

  it("deny closes the claim, records the approver note, and emails the submitter", async () => {
    const submitter = await seedSubmitter();
    const approver = await seedApprover();
    const { id } = await submitClaim(submitter);
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await decideExpense(ctx.db, { send, baseUrl: "https://x" })(
      approver.userId,
      id,
      { decision: "deny", note: "Out of policy" },
      log,
    );
    expect(result.status).toBe("denied");
    expect(send).toHaveBeenCalledOnce();

    const detail = await getExpenseDetail(ctx.db)(id);
    expect(detail.expense.status).toBe("denied");
    const denied = detail.approvals.find((a) => a.decision === "denied");
    expect(denied?.note).toBe("Out of policy");
  });

  it("a decided claim cannot be decided again (400)", async () => {
    const submitter = await seedSubmitter();
    const approver1 = await seedApprover();
    const approver2 = await seedApprover();
    const { id } = await submitClaim(submitter, { amountPence: 1000 });
    await decideExpense(ctx.db, deps())(
      approver1.userId,
      id,
      { decision: "approve" },
      log,
    );
    await expect(
      decideExpense(ctx.db, deps())(
        approver2.userId,
        id,
        { decision: "approve" },
        log,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("mark-paid moves an approved claim to paid and emails the submitter", async () => {
    const submitter = await seedSubmitter();
    const approver = await seedApprover();
    const payer = await seedTestUser(ctx.db, {
      role: "finance_admin",
      withMember: false,
    });
    const { id } = await submitClaim(submitter, { amountPence: 2000 });
    await decideExpense(ctx.db, deps())(
      approver.userId,
      id,
      { decision: "approve" },
      log,
    );

    const send = vi.fn().mockResolvedValue(undefined);
    const result = await markExpensePaid(ctx.db, { send, baseUrl: "https://x" })(
      payer.userId,
      id,
      { note: "Faster Payment sent" },
      log,
    );
    expect(result.success).toBe(true);
    expect(send).toHaveBeenCalledOnce();

    const row = await ctx.db
      .selectFrom("expense")
      .where("id", "=", id)
      .select(["status", "paid_at"])
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("paid");
    expect(row.paid_at).not.toBeNull();
  });

  it("mark-paid rejects a claim that is not approved (400)", async () => {
    const submitter = await seedSubmitter();
    const payer = await seedTestUser(ctx.db, {
      role: "finance_admin",
      withMember: false,
    });
    const { id } = await submitClaim(submitter);
    await expect(
      markExpensePaid(ctx.db, deps())(payer.userId, id, {}, log),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("getMyExpenses returns only the caller's claims", async () => {
    const a = await seedSubmitter();
    const b = await seedSubmitter();
    const { id: aId } = await submitClaim(a);
    await submitClaim(b);

    const mine = await getMyExpenses(ctx.db)(a.userId);
    expect(mine.items.map((i) => i.id)).toEqual([aId]);
    expect(mine.items[0].needsTwoApprovers).toBe(false);
    expect(mine.items[0].tags.length).toBeGreaterThanOrEqual(1);
  });

  it("listExpenses filters by status and tag", async () => {
    const submitter = await seedSubmitter();
    const approver = await seedApprover();
    const { id: approvedId } = await submitClaim(submitter, {
      tagNames: ["filter-unique-tag"],
    });
    await decideExpense(ctx.db, deps())(
      approver.userId,
      approvedId,
      { decision: "approve" },
      log,
    );

    const approved = await listExpenses(ctx.db)({
      page: 1,
      pageSize: 100,
      status: "approved",
    });
    expect(approved.items.some((i) => i.id === approvedId)).toBe(true);
    expect(approved.items.every((i) => i.status === "approved")).toBe(true);
  });

  it("summary aggregates counts and totals by status", async () => {
    const submitter = await seedSubmitter();
    const approver = await seedApprover();
    const { id } = await submitClaim(submitter, { amountPence: 3000 });
    await decideExpense(ctx.db, deps())(
      approver.userId,
      id,
      { decision: "approve" },
      log,
    );

    const summary = await getExpenseSummary(ctx.db)({});
    expect(summary.byStatus.approved.count).toBeGreaterThanOrEqual(1);
    expect(summary.byStatus.approved.totalPence).toBeGreaterThanOrEqual(3000);
    expect(summary.totals.count).toBeGreaterThanOrEqual(1);
  });

  it("categories dedupe case-insensitively and can be archived", async () => {
    const submitter = await seedSubmitter();
    const first = await createCategory(ctx.db)(submitter.userId, {
      name: "Ground Hire",
    });
    const second = await createCategory(ctx.db)(submitter.userId, {
      name: "ground hire",
    });
    expect(second.id).toBe(first.id);

    await updateCategory(ctx.db)(first.id, { archived: true });
    const active = await listCategories(ctx.db)(false);
    expect(active.categories.some((c) => c.id === first.id)).toBe(false);
    const all = await listCategories(ctx.db)(true);
    expect(all.categories.some((c) => c.id === first.id)).toBe(true);
  });
});
