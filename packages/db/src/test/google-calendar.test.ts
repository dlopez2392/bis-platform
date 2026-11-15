import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import {
  getGoogleConnectionStatus, readGoogleConnectionSealed, upsertGoogleConnection, markGoogleNeedsReconnect,
  stampGoogleChecked, deleteGoogleConnection, GOOGLE_CHECKED_STAMP_MINUTES,
  type GoogleConnectionRef, type GoogleConnectionWrite,
} from "../google-calendar";

/**
 * S-22 slice 1, PR 1: the accessors for public.google_calendar_connections, end to end through the service role
 * (the migration grants nothing else). LIVE: CI's verify-db, or locally the replica plus PostgREST.
 * RED BEFORE: the module does not exist. Plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md
 * sections 1 (D5, D6, D12) and 2.
 *
 * The seal here is a stand-in that writes the row reference it was handed into a value of the sealed shape, so a
 * test can read back which (account, id, version) the accessor sealed for. The real sealer is apps/web's
 * lib/google/token-seal.ts, tested there.
 */
const SCOPE = "openid email https://www.googleapis.com/auth/calendar.freebusy";
const fakeSeal = (ref: GoogleConnectionRef) =>
  ({ sealed: `g1.${Buffer.from(JSON.stringify(ref)).toString("base64url")}`, keyVersion: 7 });
const refIn = (sealed: string): GoogleConnectionRef => JSON.parse(Buffer.from(sealed.slice(3), "base64url").toString("utf8"));
const write = (accountId: string, over: Partial<GoogleConnectionWrite> = {}): GoogleConnectionWrite => ({
  accountId, googleEmail: "owner@example.com", scope: SCOPE, refreshExpiresAt: null, connectedBy: null, seal: fakeSeal, ...over,
});

async function newTask(db: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await db.from("tasks").insert({ account_id: accountId, title: "Reconnect your Google Calendar" })
    .select("id").single();
  if (error) throw error;
  return data.id as string;
}

describe("upsertGoogleConnection", () => {
  it("a first connect inserts version 1 and seals for exactly that row", () =>
    withTestAccount(async (db, accountId) => {
      const r = await upsertGoogleConnection(db, write(accountId));
      expect(r).toMatchObject({ version: 1, previousReconnectTaskId: null });
      const sealed = await readGoogleConnectionSealed(db, accountId);
      expect(sealed).toMatchObject({ id: r.id, account_id: accountId, version: 1, status: "connected", key_version: 7 });
      expect(refIn(sealed!.refresh_token_sealed)).toEqual({ accountId, id: r.id, version: 1 });
    }));

  it("a first connect replaced nothing", () =>
    withTestAccount(async (db, accountId) => {
      expect((await upsertGoogleConnection(db, write(accountId))).replaced).toBeNull();
    }));

  it("after a retry, `replaced` is the row the write ACTUALLY overwrote, not the one first read (PR 2 re-review m1)", () =>
    withTestAccount(async (db, accountId) => {
      const x = await upsertGoogleConnection(db, write(accountId, { googleEmail: "x@example.com" })); // v1
      let raced = false;
      const a = await upsertGoogleConnection(db, write(accountId, {
        googleEmail: "z@example.com",
        // A has read v1 and is sealing for v2; B's reconnect lands first, so A's write misses and retries over v2.
        seal: async (ref) => {
          if (!raced) {
            raced = true;
            await upsertGoogleConnection(db, write(accountId, { googleEmail: "y@example.com" }));
          }
          return fakeSeal(ref);
        },
      }));
      expect(a.version).toBe(3);
      expect(a.replaced).toEqual({
        version: 2, googleEmail: "y@example.com", sealed: fakeSeal({ accountId, id: x.id, version: 2 }).sealed, keyVersion: 7,
      });
    }));

  it("a reconnect keeps the id, bumps version, re-seals for the new version and clears the needs-reconnect state", () =>
    withTestAccount(async (db, accountId) => {
      const first = await upsertGoogleConnection(db, write(accountId));
      expect(await markGoogleNeedsReconnect(db, first.id, 1)).toBe("marked");
      const task = await newTask(db, accountId);
      const { error } = await db.from("google_calendar_connections").update({ reconnect_task_id: task }).eq("id", first.id);
      if (error) throw error;

      const second = await upsertGoogleConnection(db, write(accountId, { googleEmail: "other@example.com" }));
      expect(second).toEqual({
        id: first.id, version: 2, previousReconnectTaskId: task,
        replaced: { version: 1, googleEmail: "owner@example.com", sealed: fakeSeal({ accountId, id: first.id, version: 1 }).sealed, keyVersion: 7 },
      });
      const status = await getGoogleConnectionStatus(db, accountId);
      expect(status).toMatchObject({
        id: first.id, version: 2, google_email: "other@example.com", status: "connected",
        needs_reconnect_since: null, reconnect_task_id: null, last_checked_at: null,
      });
      expect(refIn((await readGoogleConnectionSealed(db, accountId))!.refresh_token_sealed)).toEqual({ accountId, id: first.id, version: 2 });
    }));

  it("a reconnect that lands while this one is sealing is not overwritten blind: the write re-reads and seals for the next version", () =>
    withTestAccount(async (db, accountId) => {
      await upsertGoogleConnection(db, write(accountId));
      const seen: GoogleConnectionRef[] = [];
      const racing = async (ref: GoogleConnectionRef) => {
        seen.push(ref);
        if (seen.length === 1) await upsertGoogleConnection(db, write(accountId, { googleEmail: "racer@example.com" }));
        return fakeSeal(ref);
      };
      const r = await upsertGoogleConnection(db, write(accountId, { seal: racing }));
      expect(seen.map((s) => s.version)).toEqual([2, 3]);
      expect(r.version).toBe(3);
      const sealed = await readGoogleConnectionSealed(db, accountId);
      expect(refIn(sealed!.refresh_token_sealed)).toEqual({ accountId, id: r.id, version: 3 });
      expect((await getGoogleConnectionStatus(db, accountId))!.google_email).toBe("owner@example.com");
    }));

  it("a needs-reconnect mark and its To-do that land while a reconnect is sealing are seen, not nulled blind: the To-do comes back as previousReconnectTaskId (probe: CAS on version only -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await upsertGoogleConnection(db, write(accountId));
      const task = await newTask(db, accountId);
      const seen: GoogleConnectionRef[] = [];
      const racing = async (ref: GoogleConnectionRef) => {
        seen.push(ref);
        if (seen.length === 1) {
          // markGoogleNeedsReconnect does not bump version, so only status and the To-do say the row changed.
          expect(await markGoogleNeedsReconnect(db, id, 1)).toBe("marked");
          const { error } = await db.from("google_calendar_connections").update({ reconnect_task_id: task }).eq("id", id);
          if (error) throw error;
        }
        return fakeSeal(ref);
      };
      const r = await upsertGoogleConnection(db, write(accountId, { seal: racing }));
      expect(r).toMatchObject({ id, version: 2, previousReconnectTaskId: task });
      expect(seen.length).toBe(2);
      expect(await getGoogleConnectionStatus(db, accountId)).toMatchObject({ status: "connected", reconnect_task_id: null });
    }));

  it("two first connects at once end as one row, not a unique-constraint failure", () =>
    withTestAccount(async (db, accountId) => {
      let raced = false;
      const racing = async (ref: GoogleConnectionRef) => {
        if (!raced) { raced = true; await upsertGoogleConnection(db, write(accountId, { googleEmail: "racer@example.com" })); }
        return fakeSeal(ref);
      };
      const r = await upsertGoogleConnection(db, write(accountId, { seal: racing }));
      expect(r.version).toBe(2);
      const { data, error } = await db.from("google_calendar_connections").select("id").eq("account_id", accountId);
      if (error) throw error;
      expect(data).toEqual([{ id: r.id }]);
    }));

  it("connected_by and refresh_expires_at are stored as given", () =>
    withTestAccount(async (db, accountId) => {
      const at = new Date(Date.UTC(2026, 11, 1, 12));
      await upsertGoogleConnection(db, write(accountId, { refreshExpiresAt: at }));
      const status = await getGoogleConnectionStatus(db, accountId);
      expect(Date.parse(status!.refresh_expires_at!)).toBe(at.getTime());
      expect(status!.connected_by).toBeNull();
    }));
});

describe("getGoogleConnectionStatus", () => {
  it("the status read has no ciphertext field: exactly the status columns, and the sealed value appears nowhere in it (probe: select(\"*\") -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await upsertGoogleConnection(db, write(accountId));
      const sealed = (await readGoogleConnectionSealed(db, accountId))!.refresh_token_sealed;
      const status = await getGoogleConnectionStatus(db, accountId);
      expect(Object.keys(status!).sort()).toEqual([
        "account_id", "connected_at", "connected_by", "google_email", "id", "last_checked_at", "needs_reconnect_since",
        "reconnect_task_id", "refresh_expires_at", "scope", "status", "version",
      ]);
      expect(JSON.stringify(status)).not.toContain(sealed.slice(3));
    }));

  it("another account's connection is not this account's (null), and no connection is null", () =>
    withTestAccount(async (db, accountA) => {
      await upsertGoogleConnection(db, write(accountA));
      await withTestAccount(async (_db, accountB) => {
        expect(await getGoogleConnectionStatus(db, accountB)).toBeNull();
        expect(await readGoogleConnectionSealed(db, accountB)).toBeNull();
      });
    }));
});

describe("markGoogleNeedsReconnect (compare-and-set on version)", () => {
  it("the version it read is marked once: status, since, and a second mark changes nothing", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await upsertGoogleConnection(db, write(accountId));
      expect(await markGoogleNeedsReconnect(db, id, 1)).toBe("marked");
      const marked = await getGoogleConnectionStatus(db, accountId);
      expect(marked).toMatchObject({ status: "needs_reconnect", version: 1 });
      expect(marked!.needs_reconnect_since).not.toBeNull();
      expect(await markGoogleNeedsReconnect(db, id, 1)).toBe("unchanged");
      expect((await getGoogleConnectionStatus(db, accountId))!.needs_reconnect_since).toBe(marked!.needs_reconnect_since);
    }));

  it("a stale version is not marked: a reconnect that landed after the read survives (probe: drop the version predicate -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await upsertGoogleConnection(db, write(accountId));
      await upsertGoogleConnection(db, write(accountId));
      expect(await markGoogleNeedsReconnect(db, id, 1)).toBe("unchanged");
      expect(await getGoogleConnectionStatus(db, accountId)).toMatchObject({ version: 2, status: "connected", needs_reconnect_since: null });
    }));
});

describe("stampGoogleChecked (at most every GOOGLE_CHECKED_STAMP_MINUTES)", () => {
  it("stamps a never-checked row, skips a second stamp inside the interval, stamps again after it", () =>
    withTestAccount(async (db, accountId) => {
      expect(GOOGLE_CHECKED_STAMP_MINUTES).toBe(10);
      const { id } = await upsertGoogleConnection(db, write(accountId));
      const t0 = new Date(Date.UTC(2026, 10, 15, 9));
      expect(await stampGoogleChecked(db, id, 1, t0)).toBe(true);
      expect(await stampGoogleChecked(db, id, 1, new Date(t0.getTime() + 9 * 60_000))).toBe(false);
      expect(Date.parse((await getGoogleConnectionStatus(db, accountId))!.last_checked_at!)).toBe(t0.getTime());
      const t1 = new Date(t0.getTime() + 10 * 60_000);
      expect(await stampGoogleChecked(db, id, 1, t1)).toBe(true);
      expect(Date.parse((await getGoogleConnectionStatus(db, accountId))!.last_checked_at!)).toBe(t1.getTime());
    }));

  it("a read of a stale version stamps nothing: a reconnect that landed meanwhile is not shown as checked (probe: drop the version predicate -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await upsertGoogleConnection(db, write(accountId));
      await upsertGoogleConnection(db, write(accountId));
      expect(await stampGoogleChecked(db, id, 1)).toBe(false);
      expect((await getGoogleConnectionStatus(db, accountId))!.last_checked_at).toBeNull();
      expect(await stampGoogleChecked(db, id, 2)).toBe(true);
    }));

  it("a connection marked needs_reconnect is not stamped checked (probe: drop the status predicate -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await upsertGoogleConnection(db, write(accountId));
      expect(await markGoogleNeedsReconnect(db, id, 1)).toBe("marked");
      expect(await stampGoogleChecked(db, id, 1)).toBe(false);
      expect((await getGoogleConnectionStatus(db, accountId))!.last_checked_at).toBeNull();
    }));
});

describe("deleteGoogleConnection", () => {
  it("deletes the account's row and says so; a second delete finds none", () =>
    withTestAccount(async (db, accountId) => {
      await upsertGoogleConnection(db, write(accountId));
      expect(await deleteGoogleConnection(db, accountId)).toBe("deleted");
      expect(await getGoogleConnectionStatus(db, accountId)).toBeNull();
      expect(await deleteGoogleConnection(db, accountId)).toBe("none");
    }));

  it("given the (id, version) a disconnect read: a reconnect that landed since survives, and says 'changed' (PR 2 review m4)", () =>
    withTestAccount(async (db, accountId) => {
      const first = await upsertGoogleConnection(db, write(accountId));                // the disconnect reads v1 ...
      const again = await upsertGoogleConnection(db, write(accountId, { googleEmail: "new@example.com" })); // ... a reconnect lands
      expect(again.version).toBe(2);
      expect(await deleteGoogleConnection(db, accountId, { id: first.id, version: 1 })).toBe("changed");
      expect(await getGoogleConnectionStatus(db, accountId)).toMatchObject({ version: 2, google_email: "new@example.com" });
      expect(await deleteGoogleConnection(db, accountId, { id: first.id, version: 2 })).toBe("deleted");
      expect(await deleteGoogleConnection(db, accountId, { id: first.id, version: 2 })).toBe("none");
    }));

  it("the sealed read names the Google account, so a reconnect can tell whether it replaced another one", () =>
    withTestAccount(async (db, accountId) => {
      await upsertGoogleConnection(db, write(accountId, { googleEmail: "owner@example.com" }));
      expect(await readGoogleConnectionSealed(db, accountId)).toMatchObject({ google_email: "owner@example.com" });
    }));

  it("deletes only that account's row", () =>
    withTestAccount(async (db, accountA) => {
      await upsertGoogleConnection(db, write(accountA, { googleEmail: `a-${randomBytes(3).toString("hex")}@example.com` }));
      await withTestAccount(async (_db, accountB) => {
        await upsertGoogleConnection(db, write(accountB));
        expect(await deleteGoogleConnection(db, accountB)).toBe("deleted");
        expect(await getGoogleConnectionStatus(db, accountA)).not.toBeNull();
      });
    }));
});
