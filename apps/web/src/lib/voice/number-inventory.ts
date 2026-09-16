/**
 * The agency's numbers inventory — every phone number the platform holds,
 * who holds it, and which companies could take it next.
 *
 * Until this existed, a number could only be moved from ONE place: the
 * destination account's setup wizard, and only while that account had no
 * number of its own. That is the right shape for onboarding a new client and
 * the wrong shape for running a carrier account. When a client churns, the
 * number they were using is an asset — it keeps costing money at Telnyx and
 * it is the number their old customers still dial — and nothing in the app
 * would tell you it was sitting idle.
 *
 * Pure and framework-free so the two judgements below are tested directly
 * rather than only through a page that needs a live Clerk key and a live
 * database (the shape `lib/accounts/orphans.ts` and
 * `lib/auth/sole-organization.ts` use, for the same reason).
 */

import type { PhoneNumberStatus } from "@bis/db";

/** A phone number as the inventory needs it. */
export interface InventoryNumber {
  id: string;
  e164: string;
  telnyxId: string | null;
  status: PhoneNumberStatus;
  accountId: string;
  /** From the join to `accounts`; null when that join came back empty. */
  accountName: string | null;
}

/** A company a number could be moved onto. */
export interface InventoryAccount {
  id: string;
  name: string;
  /** `accounts.status === "archived"`. A `paused` company is deliberately
   *  NOT flagged: pausing is what you do to a client who may come back, and
   *  giving them a number again is exactly how they come back. Archiving is
   *  the one that means "this company is over". */
  archived: boolean;
}

export interface InventoryRow extends InventoryNumber {
  /** Companies this number may be moved to, by name. Empty is a real and
   *  common answer — see `moveTargetsFor`. */
  moveTargets: InventoryAccount[];
}

/**
 * Service state, most-committed first: what is answering real callers leads
 * the list, and what is answering nobody sinks to the bottom where it reads
 * as the reclaimable stock it is.
 *
 * NOT alphabetical by number and not newest-first. The operator's question
 * on this screen is "what is this number doing", and grouping by that answer
 * is the only ordering that makes the screen answer it at a glance.
 */
const STATUS_RANK: Record<PhoneNumberStatus, number> = {
  live: 0,
  testing: 1,
  provisioned: 2,
  released: 3,
};

/**
 * An account is OCCUPIED when it holds any number that is not `released`.
 *
 * This is the invariant the setup wizard's own move already enforced on its
 * destination (voice/actions.ts `moveNumberAction`), and it is load-bearing
 * rather than cosmetic: two active numbers on one account is not a state
 * `deriveSetupStatus` has a step for, so the wizard would stop being able to
 * describe that account at all. A `released` number is a FORMER number and
 * does not occupy the slot — which is exactly what makes a churned client's
 * account reusable.
 */
export function occupiedAccountIds(numbers: readonly InventoryNumber[]): Set<string> {
  return new Set(
    numbers.filter((n) => n.status !== "released").map((n) => n.accountId),
  );
}

/**
 * Where one number may go: every company that is not its current holder and
 * is not already occupied, by name.
 *
 * An ARCHIVED company is never a destination. Its rows still appear in this
 * inventory as a holder — an archived client's number is the single best
 * reclaim candidate there is, and hiding it would defeat the point of the
 * screen — but nothing gets moved ONTO a company someone has already
 * declared finished.
 *
 * Computed here rather than discovered by pressing a button and reading an
 * error. The action re-checks it server-side regardless (a list rendered a
 * minute ago is exactly as stale as the number of tabs the operator has
 * open) — this is so the screen does not offer a move that is going to be
 * refused.
 */
export function moveTargetsFor(
  number: InventoryNumber,
  accounts: readonly InventoryAccount[],
  occupied: ReadonlySet<string>,
): InventoryAccount[] {
  return accounts
    .filter((a) => a.id !== number.accountId && !occupied.has(a.id) && !a.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every number, in service order, each carrying where it could go next. */
export function buildNumberInventory(
  numbers: readonly InventoryNumber[],
  accounts: readonly InventoryAccount[],
): InventoryRow[] {
  const occupied = occupiedAccountIds(numbers);
  return [...numbers]
    .sort((a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.e164.localeCompare(b.e164))
    .map((n) => ({ ...n, moveTargets: moveTargetsFor(n, accounts, occupied) }));
}

export type StatusCounts = Record<PhoneNumberStatus, number>;

/**
 * The header's breakdown. DESIGN.md rule 1 — a bare "4 numbers" is a number
 * without context; what an operator needs to know from the top of this page
 * is how many of them are earning their line rental.
 */
export function countByStatus(numbers: readonly InventoryNumber[]): StatusCounts {
  const counts: StatusCounts = { provisioned: 0, testing: 0, live: 0, released: 0 };
  for (const n of numbers) counts[n.status] += 1;
  return counts;
}
