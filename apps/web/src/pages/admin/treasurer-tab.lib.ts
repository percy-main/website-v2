/**
 * Pure helpers shared by the Treasurer tab + its extracted sub-sections.
 *
 * Kept separate from the components so they can be unit tested without
 * mounting React.
 */

/**
 * Whole-day count between `chargeDate` and "now".
 *
 * Uses local time and floors so a charge from earlier today returns 0.
 * Negative inputs (charge dated in the future) return a negative number;
 * callers in the UI never display negatives but tests cover the contract.
 */
export function daysOverdue(
  chargeDate: string,
  now: Date = new Date(),
): number {
  const charge = new Date(chargeDate);
  const diffMs = now.getTime() - charge.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
