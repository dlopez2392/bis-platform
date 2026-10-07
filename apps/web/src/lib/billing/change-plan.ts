import { METER_KEYS, type PlanPriceKey, type StripePriceIds, type SubscriptionSnapshot } from "@bis/db";

/**
 * Change plan on a paid subscription (G15): each of BIS's four items gets
 * the SAME role's price from the new plan, in place (so a meter stays on its
 * meter). Null unless the subscription is exactly those four roles, once
 * each: a hand-edited subscription is refused, never half-moved.
 *
 * The roles are read inside the call, not at module load: a module-level
 * read of an `@bis/db` value breaks every test whose `vi.mock("@bis/db")`
 * factory lacks it, the moment it imports this file transitively.
 */
export function planChangeItems(snapshot: SubscriptionSnapshot, priceIds: StripePriceIds): { id: string; price: string }[] | null {
  const roles: readonly PlanPriceKey[] = ["base", ...METER_KEYS];
  if (snapshot.items.length !== roles.length) return null;
  const out: { id: string; price: string }[] = [];
  for (const role of roles) {
    const items = snapshot.items.filter((i) => i.priceKey === role);
    if (items.length !== 1) return null;
    out.push({ id: items[0]!.id, price: priceIds[role] });
  }
  return out;
}
