import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PlaceRow, EquipmentRow } from "@bis/db";
import { m } from "@/lib/messages";

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (id: string) => requireAccountAccess(id) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));

const A = "44444444-4444-4444-8444-444444444444";
const OTHER_ACCOUNT = "99999999-9999-4999-8999-999999999999";
const S = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const G = "55555555-5555-4555-8555-555555555555";
const G2 = "56565656-5656-4565-8565-565656565656";
const P = "66666666-6666-4666-8666-666666666666";
const P2 = "67676767-6767-4676-8676-676767676767";
const U = "77777777-7777-4777-8777-777777777777";
const U2 = "78787878-7878-4787-8787-787878787878";
/** Has hex letters, so its upper- and lowercase forms differ (the digit-only ids above do not). */
const LETTERED = "abcdef12-1111-4111-8111-11111111111a";
const T = "2026-10-01T12:00:00.000Z";

/**
 * The request client. A sentinel by identity (every write must receive exactly this object), plus
 * the two reads the actions make on it directly: a membership probe and the account's zone.
 */
let memberships: [contactId: string, groupId: string][] = [];
let accountZone: string | null = "America/Chicago";
const memberProbes: Record<string, unknown>[] = [];
const REQUEST = {
  tag: "request-db",
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const builder = {
      select: () => builder,
      eq: (col: string, v: unknown) => { filters[col] = v; return builder; },
      limit: async () => {
        if (table !== "client_group_members") throw new Error(`unexpected read of ${table}`);
        memberProbes.push({ ...filters });
        const hit = filters.account_id === A
          && memberships.some(([c, g]) => c === filters.contact_id && g === filters.client_group_id);
        return { data: hit ? [{ id: "m1" }] : [], error: null };
      },
      maybeSingle: async () => {
        if (table !== "accounts" || filters.id !== A) throw new Error(`unexpected read of ${table}`);
        return { data: { timezone: accountZone }, error: null };
      },
    };
    return builder;
  },
};
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));

const writers = {
  addPlace: vi.fn(), updatePlace: vi.fn(), setPlaceOwner: vi.fn(), removePlace: vi.fn(), setPlaceArchived: vi.fn(),
  restorePlace: vi.fn(), addEquipment: vi.fn(), replaceEquipment: vi.fn(), updateEquipment: vi.fn(),
  removeEquipment: vi.fn(), restoreEquipment: vi.fn(),
};
const reads = { getContact: vi.fn(), getPlace: vi.fn(), getEquipment: vi.fn() };
const serviceDb = vi.fn(() => { throw new Error("serviceDb must never be called here"); });
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { PlaceDbError: real.PlaceDbError, ...reads, ...writers, serviceDb };
});
const { PlaceDbError } = await vi.importActual<typeof import("@bis/db")>("@bis/db");

const {
  addPlaceAction, updatePlaceFieldAction, setPlaceOwnerAction, removePlaceAction, undoRemovePlaceAction,
  setPlaceArchivedAction, addEquipmentAction, replaceEquipmentAction, updateEquipmentFieldAction,
  removeEquipmentAction, undoRemoveEquipmentAction,
} = await import("./places-actions");

const OWNER: Access = { userId: "user_1", isAgency: false, role: "owner", canManage: true };
const TECH: Access = { userId: "user_t", isAgency: false, role: "technician", canManage: false };
const UNSETTLED: Access = { userId: "user_u", isAgency: false, role: null, canManage: false };

const PLACE: PlaceRow = {
  id: P, account_id: A, contact_id: S, client_group_id: null, label: null, address: "1204 Nolana Ave",
  landmark: null, directions: null, city: null, region: null, postal_code: null, country: null,
  archived_at: null, created_by: "user_1", created_at: T, updated_at: T,
};
const GROUP_PLACE: PlaceRow = { ...PLACE, id: P2, contact_id: null, client_group_id: G };
const UNIT: EquipmentRow = {
  id: U, account_id: A, place_id: P, name: "AC upstairs", make: null, model: null, serial: null, notes: null,
  installed_on: "2020-05-01", warranty_until: null, replaces_id: null, created_by: "user_1", created_at: T, updated_at: T,
};
const NEW_UNIT: EquipmentRow = { ...UNIT, id: U2, name: "New AC", installed_on: "2026-10-01", replaces_id: U };
const hasAuthor = (v: unknown) => JSON.stringify(v).includes("user_1");

/** Every action once, with valid input, as the card would call it. */
const ALL: [name: string, run: () => Promise<{ ok: boolean }>][] = [
  ["addPlaceAction", () => addPlaceAction(A, S, { owner: `contact:${S}`, address: "1204 Nolana Ave" })],
  ["updatePlaceFieldAction", () => updatePlaceFieldAction(A, S, P, "label", "Casa")],
  ["setPlaceOwnerAction", () => setPlaceOwnerAction(A, S, P, `group:${G}`)],
  ["removePlaceAction", () => removePlaceAction(A, S, P)],
  ["undoRemovePlaceAction (deleted)", () => undoRemovePlaceAction(A, S, { mode: "deleted", snapshot: PLACE })],
  ["undoRemovePlaceAction (archived)", () => undoRemovePlaceAction(A, S, { mode: "archived", placeId: P })],
  ["setPlaceArchivedAction", () => setPlaceArchivedAction(A, S, P, false)],
  ["addEquipmentAction", () => addEquipmentAction(A, S, P, { name: "Water heater" })],
  ["replaceEquipmentAction", () => replaceEquipmentAction(A, S, U, { name: "New AC", installed_on: "2026-10-01" })],
  ["updateEquipmentFieldAction", () => updateEquipmentFieldAction(A, S, U, "make", "Carrier")],
  ["removeEquipmentAction", () => removeEquipmentAction(A, S, U)],
  ["undoRemoveEquipmentAction", () => undoRemoveEquipmentAction(A, S, UNIT)],
];
const anyWriterCalled = () => Object.values(writers).some((w) => w.mock.calls.length > 0);

beforeEach(() => {
  vi.clearAllMocks();
  memberships = [[S, G]];
  accountZone = "America/Chicago";
  memberProbes.length = 0;
  requireAccountAccess.mockResolvedValue(OWNER);
  reads.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === S || id === OTHER ? { id, first_name: "Sofía" } : null));
  reads.getPlace.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === P ? PLACE : id === P2 ? GROUP_PLACE : null));
  reads.getEquipment.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === U ? UNIT : null));
  writers.addPlace.mockResolvedValue(PLACE);
  writers.updatePlace.mockResolvedValue({ previous: { label: null }, row: { ...PLACE, label: "Casa" } });
  writers.setPlaceOwner.mockResolvedValue({ previous: { contactId: S, groupId: null }, row: GROUP_PLACE });
  writers.removePlace.mockResolvedValue({ mode: "deleted", snapshot: PLACE });
  writers.setPlaceArchived.mockResolvedValue(PLACE);
  writers.restorePlace.mockResolvedValue(PLACE);
  writers.addEquipment.mockResolvedValue(UNIT);
  writers.replaceEquipment.mockResolvedValue(NEW_UNIT);
  writers.updateEquipment.mockResolvedValue({ previous: { make: null }, row: { ...UNIT, make: "Carrier" } });
  writers.removeEquipment.mockResolvedValue(UNIT);
  writers.restoreEquipment.mockResolvedValue(UNIT);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); });

describe("places-actions: the proofs before any write", () => {
  it("every action proves the record through the request client first and writes nothing when it is hidden (mutation: delete the getContact proof in removePlaceAction -> FAILS)", async () => {
    reads.getContact.mockResolvedValue(null);
    for (const [name, run] of ALL) {
      expect([name, await run()]).toEqual([name, { ok: false, error: "places.refused" }]);
      expect([name, anyWriterCalled()]).toEqual([name, false]);
    }
    expect(reads.getContact.mock.calls.every((c) => c[0] === REQUEST && c[1] === A && c[2] === S)).toBe(true);
  });

  it("a target the request client cannot read is refused before any write", async () => {
    reads.getPlace.mockResolvedValue(null);
    reads.getEquipment.mockResolvedValue(null);
    const targeted = ALL.filter(([name]) => name !== "addPlaceAction" && name !== "undoRemovePlaceAction (deleted)");
    for (const [name, run] of targeted) {
      expect([name, await run()]).toEqual([name, { ok: false, error: "places.refused" }]);
      expect([name, anyWriterCalled()]).toEqual([name, false]);
    }
    expect(reads.getPlace.mock.calls.every((c) => c[0] === REQUEST)).toBe(true);
    expect(reads.getEquipment.mock.calls.every((c) => c[0] === REQUEST)).toBe(true);
  });

  it("a property readable but not on this record (another customer's, or a group the record is not in) is refused before any write", async () => {
    reads.getPlace.mockImplementation(async (_db: unknown, _a: string, id: string) => (
      id === P ? { ...PLACE, contact_id: OTHER } : id === P2 ? { ...GROUP_PLACE, client_group_id: G2 } : null));
    for (const run of [
      () => updatePlaceFieldAction(A, S, P, "label", "Casa"), () => updatePlaceFieldAction(A, S, P2, "label", "Casa"),
      () => removePlaceAction(A, S, P), () => setPlaceArchivedAction(A, S, P2, true),
      () => addEquipmentAction(A, S, P, { name: "AC" }), () => removeEquipmentAction(A, S, U),
    ]) {
      expect(await run()).toEqual({ ok: false, error: "places.refused" });
    }
    expect(anyWriterCalled()).toBe(false);
  });

  it("a property shared by one of the record's groups is on the record (the membership is read on the request client, fenced to the account)", async () => {
    expect(await updatePlaceFieldAction(A, S, P2, "label", "Casa")).toEqual({ ok: true });
    expect(writers.updatePlace).toHaveBeenCalledTimes(1);
    expect(memberProbes).toEqual([{ account_id: A, contact_id: S, client_group_id: G }]);
  });

  it("ids that are not ids are refused without reading anything", async () => {
    expect(await removePlaceAction(A, S, "not-a-uuid")).toEqual({ ok: false, error: "places.error.invalid" });
    expect(await removeEquipmentAction(A, "nope", U)).toEqual({ ok: false, error: "places.error.invalid" });
    expect(reads.getContact).not.toHaveBeenCalled();
    expect(anyWriterCalled()).toBe(false);
  });
});

describe("addPlaceAction", () => {
  it("addPlaceAction refuses an owner that is neither the record nor one of its groups, and adds with the record's own owner (mutation: skip the owner check -> FAILS)", async () => {
    expect(await addPlaceAction(A, S, { owner: `group:${G2}`, address: "1204 Nolana Ave" })).toEqual({ ok: false, error: "places.refused" });
    expect(await addPlaceAction(A, S, { owner: `contact:${OTHER}`, address: "1204 Nolana Ave" })).toEqual({ ok: false, error: "places.refused" });
    expect(writers.addPlace).not.toHaveBeenCalled();

    const own = await addPlaceAction(A, S, { address: "1204 Nolana Ave" });
    expect(own.ok).toBe(true);
    expect(writers.addPlace).toHaveBeenLastCalledWith(REQUEST, A, { contactId: S, groupId: null },
      expect.objectContaining({ address: "1204 Nolana Ave", label: null }), { subjectId: S, actorId: "user_1" });
    await addPlaceAction(A, S, { owner: `group:${G}`, landmark: "the blue house past the canal" });
    expect(writers.addPlace).toHaveBeenLastCalledWith(REQUEST, A, { contactId: null, groupId: G },
      expect.objectContaining({ landmark: "the blue house past the canal" }), { subjectId: S, actorId: "user_1" });
  });

  it("an owner value that is not one is invalid, and a place with no way to find it is places.needOne, neither written", async () => {
    expect(await addPlaceAction(A, S, { owner: "landlord", address: "1204 Nolana Ave" })).toEqual({ ok: false, error: "places.error.invalid" });
    expect(await addPlaceAction(A, S, { label: "Casa" })).toEqual({ ok: false, error: "places.needOne" });
    expect(writers.addPlace).not.toHaveBeenCalled();
  });

  it("hands the new row back with no author id (the browser never gets created_by)", async () => {
    const r = await addPlaceAction(A, S, { address: "1204 Nolana Ave" });
    expect(r).toEqual({ ok: true, place: { ...PLACE, created_by: null } });
    expect(hasAuthor(r)).toBe(false);
  });
});

describe("setPlaceOwnerAction", () => {
  it("a Technician changing who a property belongs to is refused with the Owner-or-Staff copy, before any write (mutation: drop the seesWholeAccount pre-check -> FAILS)", async () => {
    for (const access of [TECH, UNSETTLED]) {
      requireAccountAccess.mockResolvedValue(access);
      expect(await setPlaceOwnerAction(A, S, P, `group:${G}`)).toEqual({ ok: false, error: "places.moveRefused" });
      // Even a change that would change nothing: places.ts answers a no-op without writing, so it
      // must never be reached for a caller who may not make the change at all.
      expect(await setPlaceOwnerAction(A, S, P, `contact:${S}`)).toEqual({ ok: false, error: "places.moveRefused" });
    }
    expect(writers.setPlaceOwner).not.toHaveBeenCalled();
    expect(m["places.moveRefused.es"]).toBeTruthy();
  });

  it("an Owner moves a property to one of the record's groups; a group the record is not in is refused", async () => {
    expect(await setPlaceOwnerAction(A, S, P, `group:${G}`)).toEqual({ ok: true });
    expect(writers.setPlaceOwner).toHaveBeenCalledWith(REQUEST, A, P, { contactId: null, groupId: G }, { subjectId: S, actorId: "user_1" });
    writers.setPlaceOwner.mockClear();
    expect(await setPlaceOwnerAction(A, S, P, `group:${G2}`)).toEqual({ ok: false, error: "places.refused" });
    expect(await setPlaceOwnerAction(A, S, P, "group:nope")).toEqual({ ok: false, error: "places.error.invalid" });
    expect(writers.setPlaceOwner).not.toHaveBeenCalled();
  });

  it("the owner guard's own refusal (42501) still reads as the Owner-or-Staff copy (spec §6)", async () => {
    writers.setPlaceOwner.mockRejectedValueOnce(new PlaceDbError("places_owner_guard", "42501"));
    expect(await setPlaceOwnerAction(A, S, P, `group:${G}`)).toEqual({ ok: false, error: "places.moveRefused" });
  });
});

describe("removing and putting back a property", () => {
  it("removePlaceAction hands back the Undo for each mode, and undoRemovePlaceAction restores a deleted place or clears an archive", async () => {
    const deleted = await removePlaceAction(A, S, P);
    expect(deleted).toEqual({ ok: true, undo: { mode: "deleted", snapshot: { ...PLACE, created_by: null } } });
    writers.removePlace.mockResolvedValueOnce({ mode: "archived", row: { ...PLACE, archived_at: T } });
    expect(await removePlaceAction(A, S, P)).toEqual({ ok: true, undo: { mode: "archived", placeId: P } });

    // The deleted snapshot round-trips through the browser and back.
    const undo = JSON.parse(JSON.stringify((deleted as { undo: unknown }).undo));
    expect(await undoRemovePlaceAction(A, S, undo)).toEqual({ ok: true });
    expect(writers.restorePlace).toHaveBeenCalledWith(REQUEST, A, { ...PLACE, created_by: null }, { subjectId: S, actorId: "user_1" });
    expect(await undoRemovePlaceAction(A, S, { mode: "archived", placeId: P })).toEqual({ ok: true });
    expect(writers.setPlaceArchived).toHaveBeenCalledWith(REQUEST, A, P, false, { subjectId: S, actorId: "user_1" });
  });

  it("undoRemovePlaceAction refuses another account's snapshot before any write (mutation: skip parsePlaceSnapshot's account check -> FAILS)", async () => {
    const foreign = { ...PLACE, account_id: OTHER_ACCOUNT };
    expect(await undoRemovePlaceAction(A, S, { mode: "deleted", snapshot: foreign })).toEqual({ ok: false, error: "places.error.invalid" });
    expect(await undoRemovePlaceAction(A, S, { mode: "deleted", snapshot: { ...PLACE, extra: 1 } })).toEqual({ ok: false, error: "places.error.invalid" });
    expect(await undoRemovePlaceAction(A, S, { mode: "erased", placeId: P })).toEqual({ ok: false, error: "places.error.invalid" });
    expect(writers.restorePlace).not.toHaveBeenCalled();
    expect(writers.setPlaceArchived).not.toHaveBeenCalled();
  });

  it("an Undo snapshot of a property not on this record is refused", async () => {
    expect(await undoRemovePlaceAction(A, S, { mode: "deleted", snapshot: { ...PLACE, contact_id: OTHER } })).toEqual({ ok: false, error: "places.refused" });
    expect(writers.restorePlace).not.toHaveBeenCalled();
  });

  it("removing a property already removed is refused before places.ts, which would answer it without a write and offer an Undo that puts it back", async () => {
    reads.getPlace.mockResolvedValue({ ...PLACE, archived_at: T });
    expect(await removePlaceAction(A, S, P)).toEqual({ ok: false, error: "places.error.invalid" });
    expect(writers.removePlace).not.toHaveBeenCalled();
  });

  it("put back and archive pass the flag straight through", async () => {
    expect(await setPlaceArchivedAction(A, S, P, true)).toEqual({ ok: true });
    expect(writers.setPlaceArchived).toHaveBeenLastCalledWith(REQUEST, A, P, true, { subjectId: S, actorId: "user_1" });
    expect(await setPlaceArchivedAction(A, S, P, "yes" as unknown as boolean)).toEqual({ ok: false, error: "places.error.invalid" });
  });
});

describe("editing a property", () => {
  it("updatePlaceFieldAction refuses clearing the last way to find the place (places.needOne) without a write", async () => {
    expect(await updatePlaceFieldAction(A, S, P, "address", "")).toEqual({ ok: false, error: "places.needOne" });
    expect(await updatePlaceFieldAction(A, S, P, "created_by", "x")).toEqual({ ok: false, error: "inline.invalidOption" });
    expect(writers.updatePlace).not.toHaveBeenCalled();
  });

  it("a field past its limit answers its key with the limit as a param", async () => {
    expect(await updatePlaceFieldAction(A, S, P, "label", "x".repeat(81))).toEqual({ ok: false, error: "inline.rule.tooLong", params: { max: 80 } });
  });

  it("a write places.ts reports as refused or gone is places.refused", async () => {
    writers.updatePlace.mockResolvedValueOnce("refused");
    expect(await updatePlaceFieldAction(A, S, P, "label", "Casa")).toEqual({ ok: false, error: "places.refused" });
    writers.updatePlace.mockResolvedValueOnce("not_found");
    expect(await updatePlaceFieldAction(A, S, P, "label", "Casa")).toEqual({ ok: false, error: "places.refused" });
  });
});

describe("equipment", () => {
  it("a date after the ACCOUNT's today is refused, even when it is already that day in UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T03:30:00Z")); // still 2026-10-11 in Chicago
    expect(await addEquipmentAction(A, S, P, { name: "AC", installed_on: "2026-10-12" })).toEqual({ ok: false, error: "inline.rule.future" });
    expect(await addEquipmentAction(A, S, P, { name: "AC", installed_on: "2026-10-11" })).toEqual({ ok: true, unit: { ...UNIT, created_by: null } });
    expect(writers.addEquipment).toHaveBeenCalledTimes(1);
  });

  it("a replacement needs its date and lands at the old unit's place", async () => {
    expect(await replaceEquipmentAction(A, S, U, { name: "New AC" })).toEqual({ ok: false, error: "inline.rule.required" });
    expect(writers.replaceEquipment).not.toHaveBeenCalled();
    expect(await replaceEquipmentAction(A, S, U, { name: "New AC", installed_on: "2026-10-01" })).toEqual({ ok: true, unit: { ...NEW_UNIT, created_by: null } });
    expect(writers.replaceEquipment).toHaveBeenCalledWith(REQUEST, A, U, expect.objectContaining({ name: "New AC", installed_on: "2026-10-01" }), { subjectId: S, actorId: "user_1" });
  });

  it("a warranty ending before the install date is refused on an edit", async () => {
    expect(await updateEquipmentFieldAction(A, S, U, "warranty_until", "2019-01-01")).toEqual({ ok: false, error: "equipment.warrantyBeforeInstall" });
    expect(writers.updateEquipment).not.toHaveBeenCalled();
  });

  it("removeEquipmentAction hands back its snapshot, and its Undo re-validates it (another account's, or one at a place off this record, is refused)", async () => {
    const r = await removeEquipmentAction(A, S, U);
    expect(r).toEqual({ ok: true, snapshot: { ...UNIT, created_by: null } });
    const snapshot = JSON.parse(JSON.stringify((r as { snapshot: unknown }).snapshot));
    expect(await undoRemoveEquipmentAction(A, S, snapshot)).toEqual({ ok: true });
    expect(writers.restoreEquipment).toHaveBeenCalledWith(REQUEST, A, { ...UNIT, created_by: null }, { subjectId: S, actorId: "user_1" });
    writers.restoreEquipment.mockClear();
    expect(await undoRemoveEquipmentAction(A, S, { ...UNIT, account_id: OTHER_ACCOUNT })).toEqual({ ok: false, error: "places.error.invalid" });
    expect(await undoRemoveEquipmentAction(A, S, { ...UNIT, place_id: P2, extra: true })).toEqual({ ok: false, error: "places.error.invalid" });
    reads.getPlace.mockResolvedValue({ ...PLACE, contact_id: OTHER });
    expect(await undoRemoveEquipmentAction(A, S, UNIT)).toEqual({ ok: false, error: "places.refused" });
    expect(writers.restoreEquipment).not.toHaveBeenCalled();
  });

  it("an Undo the database refuses because the unit was replaced again meanwhile (23505) reads 'Couldn't put it back.' (spec §7)", async () => {
    writers.restoreEquipment.mockRejectedValueOnce(new PlaceDbError("equipment_one_successor", "23505"));
    expect(await undoRemoveEquipmentAction(A, S, UNIT)).toEqual({ ok: false, error: "places.error.undoFailed" });
    writers.restorePlace.mockRejectedValueOnce(new PlaceDbError("places_pkey", "23505"));
    expect(await undoRemovePlaceAction(A, S, { mode: "deleted", snapshot: PLACE })).toEqual({ ok: false, error: "places.error.undoFailed" });
  });
});

describe("errors, the service client and the actor", () => {
  it("a database refusal, a duplicate replacement and a vanished target become their copy keys (mutation: map every code to places.error.failed -> FAILS)", async () => {
    writers.updatePlace.mockRejectedValueOnce(new PlaceDbError("rls", "42501"));
    expect(await updatePlaceFieldAction(A, S, P, "label", "Casa")).toEqual({ ok: false, error: "places.refused" });
    writers.replaceEquipment.mockRejectedValueOnce(new PlaceDbError("equipment_one_successor", "23505"));
    expect(await replaceEquipmentAction(A, S, U, { name: "New AC", installed_on: "2026-10-01" })).toEqual({ ok: false, error: "equipment.alreadyReplaced" });
    writers.restoreEquipment.mockRejectedValueOnce(new PlaceDbError("equipment_place_fkey", "23503"));
    expect(await undoRemoveEquipmentAction(A, S, UNIT)).toEqual({ ok: false, error: "places.error.undoFailed" });
    writers.removePlace.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await removePlaceAction(A, S, P)).toEqual({ ok: false, error: "places.error.failed" });
    for (const key of ["places.refused", "equipment.alreadyReplaced", "places.error.undoFailed", "places.error.failed"] as const) {
      expect([key, m[key], m[`${key}.es`]]).toEqual([key, expect.any(String), expect.any(String)]);
    }
  });

  it("an unexpected failure is logged with the action's name; an expected refusal is not", async () => {
    const log = vi.mocked(console.error);
    writers.updatePlace.mockRejectedValueOnce(new PlaceDbError("rls", "42501"));
    await updatePlaceFieldAction(A, S, P, "label", "Casa");
    expect(log).not.toHaveBeenCalled();
    writers.updatePlace.mockRejectedValueOnce(new PlaceDbError("places_findable", "23514"));
    expect(await updatePlaceFieldAction(A, S, P, "label", "Casa")).toEqual({ ok: false, error: "places.error.invalid" });
    expect(String(log.mock.calls[0]?.[0])).toContain("updatePlaceFieldAction");
    expect(String(log.mock.calls[0]?.[0])).toContain("23514");
  });

  it("no action ever calls serviceDb", async () => {
    for (const [name, run] of ALL) expect([name, (await run()).ok]).toEqual([name, true]);
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("every write passes the record as subjectId and the caller as actor", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    for (const [name, run] of ALL.filter(([n]) => n !== "setPlaceOwnerAction")) expect([name, (await run()).ok]).toEqual([name, true]);
    const calls = Object.entries(writers).flatMap(([name, w]) => w.mock.calls.map((c) => [name, c[0], c[c.length - 1]]));
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const [name, db, ctx] of calls) expect([name, db, ctx]).toEqual([name, REQUEST, { subjectId: S, actorId: "user_t" }]);
  });

  it("an uppercase record id is the same record: proven, matched and written lowercase (mutation: drop the subjectId .toLowerCase() -> FAILS)", async () => {
    reads.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === LETTERED ? { id } : null));
    reads.getPlace.mockResolvedValue({ ...PLACE, contact_id: LETTERED });
    expect(await updatePlaceFieldAction(A, LETTERED.toUpperCase(), P, "label", "Casa")).toEqual({ ok: true });
    expect(writers.updatePlace).toHaveBeenCalledWith(REQUEST, A, P, { label: "Casa" }, { subjectId: LETTERED, actorId: "user_1" });
    // The add's default owner is the record itself, written lowercase as PostgREST will echo it.
    expect((await addPlaceAction(A, LETTERED.toUpperCase(), { address: "1204 Nolana Ave" })).ok).toBe(true);
    expect(writers.addPlace).toHaveBeenCalledWith(REQUEST, A, { contactId: LETTERED, groupId: null },
      expect.anything(), { subjectId: LETTERED, actorId: "user_1" });
  });
});
