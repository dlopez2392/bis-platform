import { describe, it, expect } from "vitest";
import type { PhoneNumberStatus } from "@bis/db";
import {
  buildNumberInventory, countByStatus, moveTargetsFor, occupiedAccountIds,
  type InventoryNumber,
} from "./number-inventory";

const num = (
  id: string, e164: string, status: PhoneNumberStatus, accountId: string,
  accountName: string | null = accountId,
): InventoryNumber => ({ id, e164, telnyxId: null, status, accountId, accountName });

const acct = (id: string, name: string, archived = false) => ({ id, name, archived });

const ACCOUNTS = [
  acct("acct_woodworks", "956 Woodworks"),
  acct("acct_resaca", "Resaca Air"),
  acct("acct_test", "Test Client One"),
];

describe("occupiedAccountIds", () => {
  it("counts live, testing and provisioned as occupying the slot", () => {
    const occupied = occupiedAccountIds([
      num("n1", "+1111", "live", "acct_a"),
      num("n2", "+1222", "testing", "acct_b"),
      num("n3", "+1333", "provisioned", "acct_c"),
    ]);
    expect([...occupied].sort()).toEqual(["acct_a", "acct_b", "acct_c"]);
  });

  /**
   * The rule that makes a churned client's account reusable, and the one a
   * careless "any number at all means occupied" would break: after the old
   * client's line is released, that account can take a number again.
   */
  it("does not count a released number", () => {
    expect(occupiedAccountIds([num("n1", "+1111", "released", "acct_a")]).size).toBe(0);
  });

  it("treats an account holding both a released and a live number as occupied", () => {
    const occupied = occupiedAccountIds([
      num("n1", "+1111", "released", "acct_a"),
      num("n2", "+1222", "live", "acct_a"),
    ]);
    expect([...occupied]).toEqual(["acct_a"]);
  });
});

describe("moveTargetsFor", () => {
  it("offers every unoccupied company except the one already holding it", () => {
    const n = num("n1", "+1111", "released", "acct_test");
    const targets = moveTargetsFor(n, ACCOUNTS, occupiedAccountIds([n]));
    expect(targets.map((a) => a.name)).toEqual(["956 Woodworks", "Resaca Air"]);
  });

  /**
   * The destination-occupied invariant, enforced by not offering the move at
   * all. `moveNumberAction`'s own re-check is the boundary; this is what
   * keeps the screen from proposing something it knows will be refused.
   */
  it("withholds a company that already has an active number", () => {
    const numbers = [
      num("n1", "+1111", "released", "acct_test"),
      num("n2", "+1222", "live", "acct_resaca"),
    ];
    const targets = moveTargetsFor(numbers[0]!, ACCOUNTS, occupiedAccountIds(numbers));
    expect(targets.map((a) => a.id)).toEqual(["acct_woodworks"]);
  });

  it("never offers the number's own current holder", () => {
    // Mutation: drop the `a.id !== number.accountId` filter — this fails.
    const n = num("n1", "+1111", "released", "acct_woodworks");
    const targets = moveTargetsFor(n, ACCOUNTS, occupiedAccountIds([n]));
    expect(targets.map((a) => a.id)).not.toContain("acct_woodworks");
  });

  it("returns nothing when every other company is occupied", () => {
    const numbers = [
      num("n1", "+1111", "live", "acct_test"),
      num("n2", "+1222", "live", "acct_resaca"),
      num("n3", "+1333", "live", "acct_woodworks"),
    ];
    expect(moveTargetsFor(numbers[0]!, ACCOUNTS, occupiedAccountIds(numbers))).toEqual([]);
  });

  /**
   * The churn rule's other half. An archived company's own number stays
   * visible in the inventory — it is the best reclaim candidate there is —
   * but nothing is ever moved ONTO a company someone has declared finished.
   */
  it("never offers an archived company as a destination", () => {
    const n = num("n1", "+1111", "released", "acct_test");
    const accounts = [acct("acct_woodworks", "956 Woodworks"), acct("acct_gone", "Closed Co", true)];
    expect(moveTargetsFor(n, accounts, occupiedAccountIds([n])).map((a) => a.id))
      .toEqual(["acct_woodworks"]);
  });

  it("still lists a number HELD by an archived company", () => {
    // Mutation: filter archived holders out of buildNumberInventory — this
    // fails, and a churned client's number becomes invisible.
    const numbers = [num("n1", "+1111", "live", "acct_gone", "Closed Co")];
    const rows = buildNumberInventory(numbers, [acct("acct_gone", "Closed Co", true)]);
    expect(rows.map((r) => r.e164)).toEqual(["+1111"]);
  });

  it("sorts targets by name, not by the order accounts came back in", () => {
    const n = num("n1", "+1111", "released", "acct_test");
    const shuffled = [ACCOUNTS[1]!, ACCOUNTS[0]!];
    expect(moveTargetsFor(n, shuffled, occupiedAccountIds([n])).map((a) => a.name))
      .toEqual(["956 Woodworks", "Resaca Air"]);
  });
});

describe("buildNumberInventory", () => {
  it("orders by service state: live, testing, provisioned, released", () => {
    const numbers = [
      num("n1", "+1444", "released", "acct_test"),
      num("n2", "+1333", "provisioned", "acct_woodworks"),
      num("n3", "+1111", "live", "acct_resaca"),
      num("n4", "+1222", "testing", "acct_other"),
    ];
    expect(buildNumberInventory(numbers, ACCOUNTS).map((r) => r.status))
      .toEqual(["live", "testing", "provisioned", "released"]);
  });

  it("breaks a status tie on the number itself, so the order is stable", () => {
    const numbers = [
      num("n1", "+19999999999", "released", "acct_a"),
      num("n2", "+15555555555", "released", "acct_b"),
    ];
    expect(buildNumberInventory(numbers, []).map((r) => r.e164))
      .toEqual(["+15555555555", "+19999999999"]);
  });

  it("does not mutate the array it was given", () => {
    const numbers = [
      num("n1", "+1444", "released", "acct_test"),
      num("n2", "+1111", "live", "acct_resaca"),
    ];
    buildNumberInventory(numbers, ACCOUNTS);
    expect(numbers.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  /**
   * The real state of the platform on the day this shipped: one released
   * number on Test Client One, one in testing on BIS, one live on Resaca
   * Air. The released one is the only movable asset, and 956 Woodworks —
   * holding nothing — is the only place it can go.
   */
  it("offers the idle number to the one company that can take it", () => {
    const numbers = [
      num("n1", "+19567055146", "released", "acct_test", "Test Client One"),
      num("n2", "+19565061545", "testing", "acct_bis", "BIS"),
      num("n3", "+19565550100", "live", "acct_resaca", "Resaca Air"),
    ];
    const accounts = [
      acct("acct_test", "Test Client One"),
      acct("acct_bis", "BIS"),
      acct("acct_resaca", "Resaca Air"),
      acct("acct_woodworks", "956 Woodworks"),
    ];
    const rows = buildNumberInventory(numbers, accounts);
    const idle = rows.find((r) => r.e164 === "+19567055146")!;
    expect(idle.moveTargets.map((a) => a.name)).toEqual(["956 Woodworks"]);
    // The live one may go to 956 Woodworks too — and to Test Client One,
    // whose only number is released, which is precisely the churn case: the
    // slot a departed client left behind is free to fill again.
    const live = rows.find((r) => r.e164 === "+19565550100")!;
    expect(live.moveTargets.map((a) => a.name)).toEqual(["956 Woodworks", "Test Client One"]);
  });

  it("handles no numbers at all", () => {
    expect(buildNumberInventory([], ACCOUNTS)).toEqual([]);
  });
});

describe("countByStatus", () => {
  it("reports every status, including the ones with none", () => {
    expect(countByStatus([
      num("n1", "+1111", "live", "acct_a"),
      num("n2", "+1222", "released", "acct_b"),
      num("n3", "+1333", "released", "acct_c"),
    ])).toEqual({ provisioned: 0, testing: 0, live: 1, released: 2 });
  });

  it("reports all zeros for an empty inventory", () => {
    expect(countByStatus([])).toEqual({ provisioned: 0, testing: 0, live: 0, released: 0 });
  });
});
