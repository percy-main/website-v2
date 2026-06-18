import { z } from "zod";

/**
 * Shared constants and types for the expenses reimbursement feature
 * (EXPENSES.md). Kept here so the API (validation, state machine) and the web
 * (form rules, copy) read the same thresholds and never drift.
 */

/**
 * Claims of this amount or more require two distinct approvers before they can
 * be paid. Below it, a single approval is enough. (EXPENSES.md decision 13.5.)
 */
export const EXPENSE_TWO_APPROVAL_THRESHOLD_PENCE = 5000;

/**
 * A receipt image is mandatory for claims over this amount (EXPENSES.md
 * decision 13.9). Smaller claims may attach one but are not required to.
 */
export const EXPENSE_RECEIPT_REQUIRED_ABOVE_PENCE = 1000;

export const EXPENSE_STATUSES = [
  "pending",
  "awaiting_second_approval",
  "approved",
  "denied",
  "paid",
  "payout_failed",
] as const;

export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  pending: "Pending approval",
  awaiting_second_approval: "Awaiting second approval",
  approved: "Approved",
  denied: "Denied",
  paid: "Paid",
  payout_failed: "Payout failed",
};

/** True iff a claim of this amount needs two distinct approvers. */
export function expenseNeedsTwoApprovers(amountPence: number): boolean {
  return amountPence >= EXPENSE_TWO_APPROVAL_THRESHOLD_PENCE;
}

/** True iff a claim of this amount must carry a receipt. */
export function expenseReceiptRequired(amountPence: number): boolean {
  return amountPence > EXPENSE_RECEIPT_REQUIRED_ABOVE_PENCE;
}
