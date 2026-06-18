import type { DB } from "@percy-main/db";
import { ExpenseDecision, ExpenseSubmitted, type Email } from "@percy-main/email";
import {
  EXPENSE_STATUSES,
  expenseNeedsTwoApprovers,
  type ExpenseStatus,
} from "@percy-main/shared";
import type { FastifyBaseLogger } from "fastify";
import { sql, type Kysely } from "kysely";
import { createElement } from "react";
import { render } from "react-email";
import type { S3Uploader } from "../../lib/s3-upload.ts";
import type {
  CreateCategory,
  DecideExpense,
  ListExpenses,
  MarkPaidExpense,
  SubmitExpense,
  SummaryQuery,
  UpdateCategory,
} from "./schemas.ts";

function httpError(statusCode: number, message: string): never {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  throw err;
}

function toIsoString(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

type Executor = Kysely<DB>;

const RECEIPT_DATA_URL = /^data:(image\/(?:jpeg|png|webp|heic));base64,(.+)$/;

interface Deps {
  s3: S3Uploader;
  send: (email: Email) => Promise<void>;
  baseUrl: string;
}

type NotifyDeps = Pick<Deps, "send" | "baseUrl">;

// --- Shared helpers ------------------------------------------------------

/**
 * Resolve a set of tag names to category ids, creating any that don't exist
 * yet (case-insensitive dedupe via the lower(name) unique index). Both the
 * claimant (at submit) and the approver (at decision) grow the shared
 * vocabulary this way.
 */
async function resolveTagIds(
  exec: Executor,
  names: string[],
  actorUserId: string | null,
): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const existing = await exec
      .selectFrom("expense_category")
      .where(sql`lower(name)`, "=", key)
      .select(["id"])
      .executeTakeFirst();
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    try {
      const inserted = await exec
        .insertInto("expense_category")
        .values({ name, created_by: actorUserId })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      ids.push(inserted.id);
    } catch (err: unknown) {
      // Lost a race on the lower(name) unique index — re-read the winner.
      if (
        err instanceof Error &&
        err.message.includes("expense_category_name_lower_uniq")
      ) {
        const winner = await exec
          .selectFrom("expense_category")
          .where(sql`lower(name)`, "=", key)
          .select(["id"])
          .executeTakeFirstOrThrow();
        ids.push(winner.id);
      } else {
        throw err;
      }
    }
  }
  return ids;
}

async function setExpenseTags(
  exec: Executor,
  expenseId: string,
  categoryIds: string[],
): Promise<void> {
  await exec
    .deleteFrom("expense_category_link")
    .where("expense_id", "=", expenseId)
    .execute();
  if (categoryIds.length > 0) {
    await exec
      .insertInto("expense_category_link")
      .values(categoryIds.map((id) => ({ expense_id: expenseId, category_id: id })))
      .execute();
  }
}

/** Tags + approval counts for a page of expenses, batched to avoid N+1. */
async function loadRowExtras(db: Kysely<DB>, expenseIds: string[]) {
  if (expenseIds.length === 0) {
    return {
      tagsByExpense: new Map<string, { id: string; name: string }[]>(),
      approvalCountByExpense: new Map<string, number>(),
      decidedAtByExpense: new Map<string, string>(),
    };
  }

  const tagRows = await db
    .selectFrom("expense_category_link as l")
    .innerJoin("expense_category as c", "c.id", "l.category_id")
    .where("l.expense_id", "in", expenseIds)
    .select(["l.expense_id as expenseId", "c.id as id", "c.name as name"])
    .orderBy("c.name", "asc")
    .execute();
  const tagsByExpense = new Map<string, { id: string; name: string }[]>();
  for (const t of tagRows) {
    const list = tagsByExpense.get(t.expenseId) ?? [];
    list.push({ id: t.id, name: t.name });
    tagsByExpense.set(t.expenseId, list);
  }

  const approvalRows = await db
    .selectFrom("expense_approval")
    .where("expense_id", "in", expenseIds)
    .where("decision", "=", "approved")
    .select((eb) => [
      "expense_id as expenseId",
      eb.fn.countAll<string>().as("count"),
      eb.fn.max("created_at").as("latest"),
    ])
    .groupBy("expense_id")
    .execute();
  const approvalCountByExpense = new Map<string, number>();
  const decidedAtByExpense = new Map<string, string>();
  for (const a of approvalRows) {
    approvalCountByExpense.set(a.expenseId, Number(a.count));
    if (a.latest) decidedAtByExpense.set(a.expenseId, toIsoString(a.latest));
  }

  return { tagsByExpense, approvalCountByExpense, decidedAtByExpense };
}

interface ExpenseBaseRow {
  id: string;
  created_by: string;
  claimant_name: string;
  description: string;
  amount_pence: number;
  currency: string;
  status: string;
  receipt_image_url: string | null;
  paid_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function mapRow(
  row: ExpenseBaseRow,
  extras: Awaited<ReturnType<typeof loadRowExtras>>,
) {
  return {
    id: row.id,
    claimantUserId: row.created_by,
    claimantName: row.claimant_name,
    description: row.description,
    amountPence: row.amount_pence,
    currency: row.currency,
    status: row.status as ExpenseStatus,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    decidedAt: extras.decidedAtByExpense.get(row.id) ?? null,
    paidAt: row.paid_at ? toIsoString(row.paid_at) : null,
    approvalCount: extras.approvalCountByExpense.get(row.id) ?? 0,
    needsTwoApprovers: expenseNeedsTwoApprovers(row.amount_pence),
    hasReceipt: row.receipt_image_url !== null,
    tags: extras.tagsByExpense.get(row.id) ?? [],
  };
}

// --- Notifications -------------------------------------------------------

async function notifyApprovers(
  db: Kysely<DB>,
  deps: NotifyDeps,
  args: {
    claimantName: string;
    amountPence: number;
    description: string;
    secondApproval: boolean;
  },
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const approvers = await db
      .selectFrom("user")
      .where("role", "ilike", "%expense_approver%")
      .where("email", "is not", null)
      .select(["email"])
      .execute();
    if (approvers.length === 0) return;

    const html = await render(
      createElement(ExpenseSubmitted.component, {
        imageBaseUrl: `${deps.baseUrl}/images`,
        claimantName: args.claimantName,
        amountPence: args.amountPence,
        description: args.description,
        secondApproval: args.secondApproval,
        reviewUrl: `${deps.baseUrl}/admin?section=finance&tab=expenses`,
      }),
    );
    await Promise.all(
      approvers.map((a) =>
        deps.send({
          to: a.email,
          subject: ExpenseSubmitted.subject,
          html,
        }),
      ),
    );
  } catch (err) {
    log.error({ err }, "expense_approver_notification_failed");
  }
}

async function notifySubmitter(
  deps: NotifyDeps,
  args: {
    to: string;
    recipientName: string;
    outcome: "approved" | "denied" | "paid";
    note: string | null;
    amountPence: number;
  },
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await deps.send({
      to: args.to,
      subject: ExpenseDecision.subject,
      html: await render(
        createElement(ExpenseDecision.component, {
          imageBaseUrl: `${deps.baseUrl}/images`,
          recipientName: args.recipientName,
          outcome: args.outcome,
          note: args.note,
          amountPence: args.amountPence,
        }),
      ),
    });
  } catch (err) {
    log.error({ err }, "expense_submitter_notification_failed");
  }
}

// --- Submit --------------------------------------------------------------

export function submitExpense(db: Kysely<DB>, deps: Deps) {
  return async (
    userId: string,
    userName: string,
    data: SubmitExpense,
    log: FastifyBaseLogger,
  ) => {
    const id = crypto.randomUUID();

    let receiptUrl: string | null = null;
    if (data.receiptImage) {
      const match = RECEIPT_DATA_URL.exec(data.receiptImage);
      if (!match) {
        httpError(400, "Receipt must be a base64 image data URL");
      }
      receiptUrl = await deps.s3.uploadReceipt({
        imageBytes: Buffer.from(match[2], "base64"),
        contentType: match[1],
        expenseId: id,
      });
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("expense")
        .values({
          id,
          created_by: userId,
          claimant_name: userName,
          description: data.description,
          amount_pence: data.amountPence,
          currency: "gbp",
          status: "pending",
          receipt_image_url: receiptUrl,
        })
        .execute();

      const tagIds = await resolveTagIds(trx, data.tagNames, userId);
      await setExpenseTags(trx, id, tagIds);

      await trx
        .insertInto("expense_event")
        .values({
          id: crypto.randomUUID(),
          expense_id: id,
          actor_user_id: userId,
          type: "submitted",
          from_status: null,
          to_status: "pending",
          metadata: { amountPence: data.amountPence },
        })
        .execute();
    });

    await notifyApprovers(
      db,
      deps,
      {
        claimantName: userName,
        amountPence: data.amountPence,
        description: data.description,
        secondApproval: false,
      },
      log,
    );

    return { id };
  };
}

// --- Listing -------------------------------------------------------------

export function getMyExpenses(db: Kysely<DB>) {
  return async (userId: string) => {
    const rows = await db
      .selectFrom("expense")
      .where("created_by", "=", userId)
      .selectAll()
      .orderBy("created_at", "desc")
      .execute();
    const extras = await loadRowExtras(
      db,
      rows.map((r) => r.id),
    );
    return { items: rows.map((r) => mapRow(r, extras)) };
  };
}

export function listExpenses(db: Kysely<DB>) {
  return async (params: ListExpenses) => {
    const offset = (params.page - 1) * params.pageSize;

    let base = db.selectFrom("expense");
    if (params.status !== "all") {
      base = base.where("status", "=", params.status);
    }
    if (params.dateFrom) {
      base = base.where("created_at", ">=", new Date(params.dateFrom));
    }
    if (params.dateTo) {
      base = base.where("created_at", "<=", new Date(params.dateTo));
    }
    if (params.search) {
      const like = `%${params.search}%`;
      base = base.where((eb) =>
        eb.or([
          eb("claimant_name", "ilike", like),
          eb("description", "ilike", like),
        ]),
      );
    }
    if (params.tagId) {
      const tagId = params.tagId;
      base = base.where((eb) =>
        eb.exists(
          eb
            .selectFrom("expense_category_link as fl")
            .whereRef("fl.expense_id", "=", "expense.id")
            .where("fl.category_id", "=", tagId)
            .select("fl.expense_id"),
        ),
      );
    }

    const [{ total }, rows] = await Promise.all([
      base
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow(),
      base
        .selectAll()
        .orderBy("created_at", "desc")
        .limit(params.pageSize)
        .offset(offset)
        .execute(),
    ]);

    const extras = await loadRowExtras(
      db,
      rows.map((r) => r.id),
    );

    return {
      items: rows.map((r) => mapRow(r, extras)),
      total: Number(total),
      page: params.page,
      pageSize: params.pageSize,
    };
  };
}

export function getExpenseDetail(db: Kysely<DB>) {
  return async (expenseId: string) => {
    const expense = await db
      .selectFrom("expense as e")
      .leftJoin("user as u", "u.id", "e.created_by")
      .where("e.id", "=", expenseId)
      .select([
        "e.id",
        "e.created_by as createdBy",
        "e.claimant_name as claimantName",
        "u.email as claimantEmail",
        "e.description",
        "e.amount_pence as amountPence",
        "e.currency",
        "e.status",
        "e.receipt_image_url as receiptImageUrl",
        "e.payout_failure_reason as payoutFailureReason",
        "e.stripe_outbound_payment_id as stripeOutboundPaymentId",
        "e.paid_at as paidAt",
        "e.created_at as createdAt",
        "e.updated_at as updatedAt",
      ])
      .executeTakeFirst();
    if (!expense) httpError(404, "Expense not found");

    const [tags, approvals, events] = await Promise.all([
      db
        .selectFrom("expense_category_link as l")
        .innerJoin("expense_category as c", "c.id", "l.category_id")
        .where("l.expense_id", "=", expenseId)
        .select(["c.id", "c.name"])
        .orderBy("c.name", "asc")
        .execute(),
      db
        .selectFrom("expense_approval as a")
        .leftJoin("user as u", "u.id", "a.approver_user_id")
        .where("a.expense_id", "=", expenseId)
        .select([
          "a.id",
          "a.approver_user_id as approverUserId",
          "u.name as approverName",
          "a.decision",
          "a.note",
          "a.created_at as createdAt",
        ])
        .orderBy("a.created_at", "asc")
        .execute(),
      db
        .selectFrom("expense_event as ev")
        .leftJoin("user as u", "u.id", "ev.actor_user_id")
        .where("ev.expense_id", "=", expenseId)
        .select([
          "ev.id",
          "ev.type",
          "ev.from_status as fromStatus",
          "ev.to_status as toStatus",
          "ev.metadata",
          "ev.actor_user_id as actorUserId",
          "u.name as actorName",
          "ev.created_at as createdAt",
        ])
        .orderBy("ev.created_at", "asc")
        .execute(),
    ]);

    return {
      expense: {
        id: expense.id,
        claimantUserId: expense.createdBy,
        claimantName: expense.claimantName,
        claimantEmail: expense.claimantEmail,
        description: expense.description,
        amountPence: expense.amountPence,
        currency: expense.currency,
        status: expense.status as ExpenseStatus,
        receiptImageUrl: expense.receiptImageUrl,
        payoutFailureReason: expense.payoutFailureReason,
        stripeOutboundPaymentId: expense.stripeOutboundPaymentId,
        needsTwoApprovers: expenseNeedsTwoApprovers(expense.amountPence),
        createdAt: toIsoString(expense.createdAt),
        updatedAt: toIsoString(expense.updatedAt),
        paidAt: expense.paidAt ? toIsoString(expense.paidAt) : null,
      },
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      approvals: approvals.map((a) => ({
        id: a.id,
        approverUserId: a.approverUserId,
        approverName: a.approverName,
        decision: a.decision as "approved" | "denied",
        note: a.note,
        createdAt: toIsoString(a.createdAt),
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        note: readEventNote(e.metadata),
        actorUserId: e.actorUserId,
        actorName: e.actorName,
        createdAt: toIsoString(e.createdAt),
      })),
    };
  };
}

function readEventNote(metadata: unknown): string | null {
  if (
    metadata &&
    typeof metadata === "object" &&
    "note" in metadata &&
    typeof (metadata as { note: unknown }).note === "string"
  ) {
    return (metadata as { note: string }).note;
  }
  return null;
}

// --- Decision (approve / deny + two-approver rule) -----------------------

export function decideExpense(db: Kysely<DB>, deps: NotifyDeps) {
  return async (
    approverUserId: string,
    expenseId: string,
    data: DecideExpense,
    log: FastifyBaseLogger,
  ) => {
    const expense = await db
      .selectFrom("expense as e")
      .leftJoin("user as u", "u.id", "e.created_by")
      .where("e.id", "=", expenseId)
      .select([
        "e.id",
        "e.created_by as createdBy",
        "e.status",
        "e.amount_pence as amountPence",
        "e.claimant_name as claimantName",
        "u.email as claimantEmail",
      ])
      .executeTakeFirst();
    if (!expense) httpError(404, "Expense not found");

    if (!["pending", "awaiting_second_approval"].includes(expense.status)) {
      httpError(400, "This claim has already been decided");
    }
    // Separation of duties: an approver can never decide their own claim.
    if (expense.createdBy === approverUserId) {
      httpError(403, "You cannot approve your own expense claim");
    }

    const outcome = await db.transaction().execute(async (trx) => {
      // Record this approver's decision. The unique (expense_id,
      // approver_user_id) constraint blocks a second decision from the same
      // person, which is what makes the two-approver rule require two
      // distinct people.
      try {
        await trx
          .insertInto("expense_approval")
          .values({
            id: crypto.randomUUID(),
            expense_id: expenseId,
            approver_user_id: approverUserId,
            decision: data.decision === "approve" ? "approved" : "denied",
            note: data.note ?? null,
          })
          .execute();
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes("expense_approval_one_per_approver_uniq")
        ) {
          httpError(409, "You have already decided this claim");
        }
        throw err;
      }

      const now = new Date().toISOString();

      if (data.decision === "deny") {
        await trx
          .updateTable("expense")
          .set({ status: "denied", updated_at: now })
          .where("id", "=", expenseId)
          .execute();
        await trx
          .insertInto("expense_event")
          .values({
            id: crypto.randomUUID(),
            expense_id: expenseId,
            actor_user_id: approverUserId,
            type: "denied",
            from_status: expense.status,
            to_status: "denied",
            metadata: data.note ? { note: data.note } : null,
          })
          .execute();
        return { status: "denied" as ExpenseStatus, secondApprovalNeeded: false };
      }

      // Approve: finalise tags (approver may edit the set), then require at
      // least one tag before the claim can be approved.
      if (data.tagNames !== undefined) {
        const tagIds = await resolveTagIds(trx, data.tagNames, approverUserId);
        await setExpenseTags(trx, expenseId, tagIds);
      }
      const tagCount = await trx
        .selectFrom("expense_category_link")
        .where("expense_id", "=", expenseId)
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirstOrThrow();
      if (Number(tagCount.count) === 0) {
        httpError(400, "At least one tag is required to approve a claim");
      }

      const approvedCountRow = await trx
        .selectFrom("expense_approval")
        .where("expense_id", "=", expenseId)
        .where("decision", "=", "approved")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirstOrThrow();
      const approvedCount = Number(approvedCountRow.count);
      const needsTwo = expenseNeedsTwoApprovers(expense.amountPence);
      const nextStatus: ExpenseStatus =
        needsTwo && approvedCount < 2 ? "awaiting_second_approval" : "approved";

      await trx
        .updateTable("expense")
        .set({ status: nextStatus, updated_at: now })
        .where("id", "=", expenseId)
        .execute();
      await trx
        .insertInto("expense_event")
        .values({
          id: crypto.randomUUID(),
          expense_id: expenseId,
          actor_user_id: approverUserId,
          type: "approved",
          from_status: expense.status,
          to_status: nextStatus,
          metadata: {
            approvalCount: approvedCount,
            ...(data.note ? { note: data.note } : {}),
          },
        })
        .execute();

      return {
        status: nextStatus,
        secondApprovalNeeded: nextStatus === "awaiting_second_approval",
      };
    });

    // Notifications (best-effort).
    if (outcome.secondApprovalNeeded) {
      await notifyApprovers(
        db,
        deps,
        {
          claimantName: expense.claimantName,
          amountPence: expense.amountPence,
          description: "",
          secondApproval: true,
        },
        log,
      );
    } else if (expense.claimantEmail) {
      await notifySubmitter(
        deps,
        {
          to: expense.claimantEmail,
          recipientName: expense.claimantName,
          outcome: outcome.status === "denied" ? "denied" : "approved",
          note: data.note ?? null,
          amountPence: expense.amountPence,
        },
        log,
      );
    }

    return { status: outcome.status };
  };
}

// --- Manual mark-paid (Phase 1 fallback) ---------------------------------

export function markExpensePaid(db: Kysely<DB>, deps: NotifyDeps) {
  return async (
    actorUserId: string,
    expenseId: string,
    data: MarkPaidExpense,
    log: FastifyBaseLogger,
  ) => {
    const expense = await db
      .selectFrom("expense as e")
      .leftJoin("user as u", "u.id", "e.created_by")
      .where("e.id", "=", expenseId)
      .select([
        "e.id",
        "e.status",
        "e.amount_pence as amountPence",
        "e.claimant_name as claimantName",
        "u.email as claimantEmail",
      ])
      .executeTakeFirst();
    if (!expense) httpError(404, "Expense not found");
    if (!["approved", "payout_failed"].includes(expense.status)) {
      httpError(400, "Only an approved claim can be marked paid");
    }

    const now = new Date().toISOString();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("expense")
        .set({ status: "paid", paid_at: now, updated_at: now })
        .where("id", "=", expenseId)
        .execute();
      await trx
        .insertInto("expense_event")
        .values({
          id: crypto.randomUUID(),
          expense_id: expenseId,
          actor_user_id: actorUserId,
          type: "payout_paid",
          from_status: expense.status,
          to_status: "paid",
          metadata: {
            manual: true,
            ...(data.note ? { note: data.note } : {}),
          },
        })
        .execute();
    });

    if (expense.claimantEmail) {
      await notifySubmitter(
        deps,
        {
          to: expense.claimantEmail,
          recipientName: expense.claimantName,
          outcome: "paid",
          note: data.note ?? null,
          amountPence: expense.amountPence,
        },
        log,
      );
    }

    return { success: true };
  };
}

// --- Summary -------------------------------------------------------------

export function getExpenseSummary(db: Kysely<DB>) {
  return async (params: SummaryQuery) => {
    const from = params.dateFrom ? new Date(params.dateFrom) : null;
    const to = params.dateTo ? new Date(params.dateTo) : null;

    let statusQ = db.selectFrom("expense");
    if (from) statusQ = statusQ.where("created_at", ">=", from);
    if (to) statusQ = statusQ.where("created_at", "<=", to);
    const statusRows = await statusQ
      .select((eb) => [
        "status",
        eb.fn.countAll<string>().as("count"),
        eb.fn.coalesce(eb.fn.sum("amount_pence"), sql<string>`0`).as("sumPence"),
      ])
      .groupBy("status")
      .execute();

    const emptyBucket = () => ({ count: 0, totalPence: 0 });
    const byStatus: Record<ExpenseStatus, { count: number; totalPence: number }> =
      {
        pending: emptyBucket(),
        awaiting_second_approval: emptyBucket(),
        approved: emptyBucket(),
        denied: emptyBucket(),
        paid: emptyBucket(),
        payout_failed: emptyBucket(),
      };
    let totalCount = 0;
    let totalPence = 0;
    for (const r of statusRows) {
      if ((EXPENSE_STATUSES as readonly string[]).includes(r.status)) {
        const bucket = byStatus[r.status as ExpenseStatus];
        bucket.count = Number(r.count);
        bucket.totalPence = Number(r.sumPence);
        totalCount += bucket.count;
        totalPence += bucket.totalPence;
      }
    }

    let tagQ = db
      .selectFrom("expense_category_link as l")
      .innerJoin("expense", "expense.id", "l.expense_id")
      .innerJoin("expense_category as c", "c.id", "l.category_id");
    if (from) tagQ = tagQ.where("expense.created_at", ">=", from);
    if (to) tagQ = tagQ.where("expense.created_at", "<=", to);
    const tagRows = await tagQ
      .select((eb) => [
        "c.id as tagId",
        "c.name as tagName",
        eb.fn.countAll<string>().as("count"),
        eb.fn
          .coalesce(eb.fn.sum("expense.amount_pence"), sql<string>`0`)
          .as("sumPence"),
      ])
      .groupBy(["c.id", "c.name"])
      .orderBy("c.name", "asc")
      .execute();

    return {
      byStatus,
      byTag: tagRows.map((t) => ({
        tagId: t.tagId,
        tagName: t.tagName,
        count: Number(t.count),
        totalPence: Number(t.sumPence),
      })),
      totals: { count: totalCount, totalPence },
    };
  };
}

// --- Tag vocabulary ------------------------------------------------------

export function listCategories(db: Kysely<DB>) {
  return async (includeArchived: boolean) => {
    let q = db.selectFrom("expense_category").select(["id", "name"]);
    if (!includeArchived) {
      q = q.where("archived_at", "is", null);
    }
    const rows = await q.orderBy("name", "asc").execute();
    return { categories: rows };
  };
}

export function createCategory(db: Kysely<DB>) {
  return async (actorUserId: string, data: CreateCategory) => {
    const ids = await resolveTagIds(db, [data.name], actorUserId);
    const row = await db
      .selectFrom("expense_category")
      .where("id", "=", ids[0])
      .select(["id", "name"])
      .executeTakeFirstOrThrow();
    return row;
  };
}

export function updateCategory(db: Kysely<DB>) {
  return async (categoryId: string, data: UpdateCategory) => {
    const existing = await db
      .selectFrom("expense_category")
      .where("id", "=", categoryId)
      .select(["id"])
      .executeTakeFirst();
    if (!existing) httpError(404, "Tag not found");

    const patch: { name?: string; archived_at?: string | null } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.archived !== undefined) {
      patch.archived_at = data.archived ? new Date().toISOString() : null;
    }

    try {
      await db
        .updateTable("expense_category")
        .set(patch)
        .where("id", "=", categoryId)
        .execute();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("expense_category_name_lower_uniq")
      ) {
        httpError(409, "A tag with that name already exists");
      }
      throw err;
    }
    return { success: true };
  };
}
