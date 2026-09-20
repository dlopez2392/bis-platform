import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  createAssistant, getAssistantByPublicId, getAssistantForAccount, updateAssistant,
  createAssistantSession, getAssistantSession, appendAssistantTurn, linkSessionLead,
  countAssistantTurnsForIpSince, countAssistantTurnsForAccountSince,
  type TranscriptEntry,
} from "../assistants";
import { ALPHABET, createForm, createSubmission } from "../forms";
import { createContact } from "../contacts";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";

/**
 * The functions in `assistants.ts` against the real tables (migration
 * 0042_assistants.sql), through `withTestAccount`'s `serviceDb()` handle —
 * the same client the hosted page and the chat API use, since an
 * unauthenticated visitor has no tenant context. The GRANT and RLS side of
 * those tables is proved separately in `assistants-grants.test.ts`, which
 * reaches them as `authenticated` instead.
 *
 * `withTestAccount`'s signature was read from `./fixtures` before this file
 * was written: `withTestAccount(fn: (db: SupabaseClient, accountId: string)
 * => Promise<void>)` — one callback, two arguments, no options object.
 *
 * NOTE ON TEARDOWN: none of the three new tables is on
 * `ACCOUNT_OWNED_TABLES`, and that is deliberate — all three carry
 * `account_id … on delete cascade`, so the `accounts` delete at the end of
 * `deleteAccountCascade` carries them away. `assistants-grants.test.ts`
 * PROVES that rather than assuming it, the way
 * `alert-phone-verification-grants.test.ts` and
 * `call-proposals-grants.test.ts` do for their own cascade tables.
 */

/** A 32-hex-char ip_hash, the shape `forms/guards.ts`'s `hashIp` produces.
 *  Randomized, never a literal: this suite shares ONE Supabase project with
 *  production and the counter assertions below expect EXACT numbers, so a
 *  fixed hash would let a concurrent run of this same file inflate them —
 *  the flake class `fixtures.ts`'s `testPhoneNumber` doc-block catalogues. */
const randomIpHash = () => randomBytes(16).toString("hex");

const entry = (role: "user" | "assistant", text: string): TranscriptEntry =>
  ({ role, text, at: new Date().toISOString() });

describe("createAssistant / getAssistantForAccount", () => {
  it("mints a public_id in the newPublicId alphabet and applies the column defaults", async () => {
    await withTestAccount(async (db, accountId) => {
      const created = await createAssistant(db, accountId);

      expect(created.account_id).toBe(accountId);
      expect(created.public_id).toHaveLength(12);
      // Crockford-ish: no l, o, 0 or 1. A public id outside this alphabet
      // means something other than newPublicId() minted it.
      for (const ch of created.public_id) expect(ALPHABET).toContain(ch);

      // The defaults the migration declares, asserted one by one: a wrong
      // default here is invisible until a client sees an empty header or a
      // page that 404s on the day it is created.
      expect(created.enabled).toBe(true);
      expect(created.name).toBe("Assistant");
      expect(created.form_id).toBeNull();
      expect(created.knowledge).toBe("");
      expect(created.knowledge_urls).toEqual({});
      expect(created.faq).toEqual([]);
      expect(created.greeting).toEqual({});
      expect(created.suggestions).toEqual({});
      expect(created.locale_default).toBe("en");
      expect(created.allowed_origins).toEqual([]);

      const read = await getAssistantForAccount(db, accountId);
      expect(read?.id).toBe(created.id);
      expect(read?.public_id).toBe(created.public_id);
    });
  });

  it("accepts a patch at creation, including the form that is the lead sink", async () => {
    await withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Assistant Sink" }, "user_test");
      const created = await createAssistant(db, accountId, {
        name: "BIS Assistant",
        form_id: form.id,
        knowledge: "We answer the phone.",
        knowledge_urls: { en: "https://example.test/pack?locale=en" },
        faq: [{ q: "Hours?", a: "Eight to five." }],
        greeting: { en: "Hi — ask me anything about the shop." },
        suggestions: { en: ["What do you charge?", "Where are you?"] },
        locale_default: "es",
        allowed_origins: ["https://example.test"],
      });

      expect(created.name).toBe("BIS Assistant");
      expect(created.form_id).toBe(form.id);
      expect(created.knowledge_urls).toEqual({ en: "https://example.test/pack?locale=en" });
      expect(created.faq).toEqual([{ q: "Hours?", a: "Eight to five." }]);
      expect(created.greeting).toEqual({ en: "Hi — ask me anything about the shop." });
      expect(created.suggestions).toEqual({ en: ["What do you charge?", "Where are you?"] });
      expect(created.locale_default).toBe("es");
      expect(created.allowed_origins).toEqual(["https://example.test"]);
    });
  });

  it("one assistant per account is the DATABASE's rule, not a check a race could pass (mutation: drop assistants_one_per_account -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await createAssistant(db, accountId);
      await expect(createAssistant(db, accountId)).rejects.toThrow(/createAssistant failed/);
    });
  });

  it("returns null for an account that has none", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getAssistantForAccount(db, accountId)).toBeNull();
    });
  });
});

describe("getAssistantByPublicId", () => {
  it("finds an enabled assistant by its public id alone — no tenant context", async () => {
    await withTestAccount(async (db, accountId) => {
      const created = await createAssistant(db, accountId, { name: "Front Desk" });
      const found = await getAssistantByPublicId(db, created.public_id);
      expect(found?.id).toBe(created.id);
      expect(found?.account_id).toBe(accountId);
      expect(found?.name).toBe("Front Desk");
    });
  });

  it("hides a DISABLED assistant, while the in-account read still shows it (mutation: drop `.eq(\"enabled\", true)` -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const created = await createAssistant(db, accountId);
      await updateAssistant(db, accountId, { enabled: false });

      // The public path must answer exactly as it does for an id that never
      // existed. Settings, which has to render the off switch, must not.
      expect(await getAssistantByPublicId(db, created.public_id)).toBeNull();
      const inAccount = await getAssistantForAccount(db, accountId);
      expect(inAccount?.id).toBe(created.id);
      expect(inAccount?.enabled).toBe(false);
    });
  });

  it("returns null for a public id nobody minted", async () => {
    const db = serviceDb();
    expect(await getAssistantByPublicId(db, "zzzzzzzzzzzz")).toBeNull();
  });
});

describe("updateAssistant", () => {
  it("saves the patch, returns the saved row and moves updated_at", async () => {
    await withTestAccount(async (db, accountId) => {
      const created = await createAssistant(db, accountId);

      const saved = await updateAssistant(db, accountId, {
        name: "Sofía's colleague",
        knowledge: "We install metal roofs.",
        suggestions: { es: ["¿Cuánto cuesta?"] },
      });

      expect(saved.name).toBe("Sofía's colleague");
      expect(saved.knowledge).toBe("We install metal roofs.");
      expect(saved.suggestions).toEqual({ es: ["¿Cuánto cuesta?"] });
      // Untouched keys survive a partial patch.
      expect(saved.public_id).toBe(created.public_id);
      expect(saved.enabled).toBe(true);
      expect(new Date(saved.updated_at).getTime())
        .toBeGreaterThanOrEqual(new Date(created.updated_at).getTime());

      // And it is on the row, not just in the returned object.
      const reread = await getAssistantForAccount(db, accountId);
      expect(reread?.name).toBe("Sofía's colleague");
    });
  });

  it("throws when the account has no assistant instead of reporting a save that changed nothing (mutation: drop the `if (!data)` guard -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // PostgREST returns no error and no rows for an update matching
      // nothing. Without the guard this resolves and the caller believes it
      // saved — the setBranding lesson.
      await expect(updateAssistant(db, accountId, { name: "Nobody" }))
        .rejects.toThrow(/no assistant for account/);
    });
  });
});

describe("assistant sessions", () => {
  it("creates a session with a SERVER-issued id and the column defaults", async () => {
    await withTestAccount(async (db, accountId) => {
      const assistant = await createAssistant(db, accountId);
      const ipHash = randomIpHash();

      const { id } = await createAssistantSession(db, {
        assistantId: assistant.id, accountId, ipHash, locale: "es",
        pageUrl: "https://example.test/pricing",
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const session = await getAssistantSession(db, id);
      expect(session?.assistant_id).toBe(assistant.id);
      expect(session?.account_id).toBe(accountId);
      expect(session?.ip_hash).toBe(ipHash);
      expect(session?.locale).toBe("es");
      expect(session?.page_url).toBe("https://example.test/pricing");
      expect(session?.transcript).toEqual([]);
      expect(session?.turns).toBe(0);
      expect(session?.submission_id).toBeNull();
      expect(session?.contact_id).toBeNull();
    });
  });

  it("accepts a null page_url — a direct visit to /a/<id> has no host page", async () => {
    await withTestAccount(async (db, accountId) => {
      const assistant = await createAssistant(db, accountId);
      const { id } = await createAssistantSession(db, {
        assistantId: assistant.id, accountId, ipHash: randomIpHash(),
        locale: "en", pageUrl: null,
      });
      const session = await getAssistantSession(db, id);
      expect(session?.page_url).toBeNull();
    });
  });

  it("returns null for a session id that does not exist", async () => {
    const db = serviceDb();
    expect(await getAssistantSession(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("appendAssistantTurn", () => {
  it("writes the ledger row AND advances the session: transcript replaced, turns +1 each call (mutation: write `turns: 1` instead of current + 1 -> FAILS on the second call)", async () => {
    await withTestAccount(async (db, accountId) => {
      const assistant = await createAssistant(db, accountId);
      const ipHash = randomIpHash();
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { id: sessionId } = await createAssistantSession(db, {
        assistantId: assistant.id, accountId, ipHash, locale: "en", pageUrl: null,
      });

      const first: TranscriptEntry[] = [entry("user", "do you do metal roofs"), entry("assistant", "we do")];
      await appendAssistantTurn(db, {
        sessionId, accountId, ipHash, transcript: first,
        inputTokens: 1200, outputTokens: 90,
      });

      let session = await getAssistantSession(db, sessionId);
      expect(session?.turns).toBe(1);
      expect(session?.transcript).toEqual(first);
      expect(await countAssistantTurnsForAccountSince(db, accountId, since)).toBe(1);

      const second: TranscriptEntry[] = [...first, entry("user", "how much"), entry("assistant", "depends")];
      await appendAssistantTurn(db, {
        sessionId, accountId, ipHash, transcript: second,
        inputTokens: 1500, outputTokens: 120,
      });

      session = await getAssistantSession(db, sessionId);
      expect(session?.turns).toBe(2);
      expect(session?.transcript).toEqual(second);
      expect(await countAssistantTurnsForAccountSince(db, accountId, since)).toBe(2);

      // The ledger carries the provider's usage, not zeros.
      const { data: turns, error } = await db.from("assistant_turns")
        .select("input_tokens, output_tokens")
        // Ordered by a value this test CHOSE, not by `created_at`: two
        // inserts can share a timestamp, and then the row order — and this
        // assertion — would be arbitrary.
        .eq("session_id", sessionId).order("input_tokens", { ascending: true });
      expect(error, `turn read failed: ${error?.message}`).toBeNull();
      expect(turns).toEqual([
        { input_tokens: 1200, output_tokens: 90 },
        { input_tokens: 1500, output_tokens: 120 },
      ]);
    });
  });

  it("refuses a session that is not this account's, and does so LOUDLY (mutation: drop the `!current` guard -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const assistant = await createAssistant(db, accountId);
      const { id: sessionId } = await createAssistantSession(db, {
        assistantId: assistant.id, accountId, ipHash: randomIpHash(), locale: "en", pageUrl: null,
      });
      await expect(appendAssistantTurn(db, {
        sessionId,
        // A real uuid that is not this session's account. The session update
        // would match zero rows and report success without the guard.
        accountId: "00000000-0000-0000-0000-000000000000",
        ipHash: randomIpHash(), transcript: [], inputTokens: 0, outputTokens: 0,
      })).rejects.toThrow(/appendAssistantTurn failed/);
    });
  });
});

describe("countAssistantTurnsForIpSince / countAssistantTurnsForAccountSince", () => {
  it("each counter counts only its own key — two hashed IPs under one account (mutation: swap the two `.eq()` filter columns -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const assistant = await createAssistant(db, accountId);
      const ipX = randomIpHash();
      const ipY = randomIpHash();
      const since = new Date(Date.now() - 3600_000).toISOString();

      const sessionFor = async (ipHash: string) => (await createAssistantSession(db, {
        assistantId: assistant.id, accountId, ipHash, locale: "en", pageUrl: null,
      })).id;

      const sx = await sessionFor(ipX);
      const sy = await sessionFor(ipY);
      // Two turns on X, one on Y: neither counter can be right by accident.
      await appendAssistantTurn(db, { sessionId: sx, accountId, ipHash: ipX, transcript: [], inputTokens: 10, outputTokens: 1 });
      await appendAssistantTurn(db, { sessionId: sx, accountId, ipHash: ipX, transcript: [], inputTokens: 10, outputTokens: 1 });
      await appendAssistantTurn(db, { sessionId: sy, accountId, ipHash: ipY, transcript: [], inputTokens: 10, outputTokens: 1 });

      // A swapped `.eq` in the IP counter would compare a uuid column to a
      // hex string (an error, not a wrong number); a swapped `.eq` in the
      // account counter would compare ip_hash to a uuid and find nothing.
      expect(await countAssistantTurnsForIpSince(db, ipX, since)).toBe(2);
      expect(await countAssistantTurnsForIpSince(db, ipY, since)).toBe(1);
      expect(await countAssistantTurnsForAccountSince(db, accountId, since)).toBe(3);
    });
  });

  it("sinceIso bounds the window — a turn older than the cutoff is not counted (mutation: drop `.gte(\"created_at\", sinceIso)` -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const assistant = await createAssistant(db, accountId);
      const ipHash = randomIpHash();
      const { id: sessionId } = await createAssistantSession(db, {
        assistantId: assistant.id, accountId, ipHash, locale: "en", pageUrl: null,
      });

      // OLD: written directly with an explicit past `created_at`.
      // `appendAssistantTurn` always stamps `now()` (the column default,
      // which is what the real route does), so reaching the far side of the
      // window requires setting the column by hand — for this fixture row
      // only, the same bypass `voice-web-sessions.test.ts` uses.
      const { error: oldErr } = await db.from("assistant_turns").insert({
        session_id: sessionId, account_id: accountId, ip_hash: ipHash,
        input_tokens: 5, output_tokens: 5,
        created_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
      });
      expect(oldErr, `old-turn insert failed: ${oldErr?.message}`).toBeNull();

      const since = new Date().toISOString();
      await appendAssistantTurn(db, {
        sessionId, accountId, ipHash, transcript: [], inputTokens: 7, outputTokens: 7,
      });

      // One turn on each side of the cutoff; only the new one counts.
      expect(await countAssistantTurnsForIpSince(db, ipHash, since)).toBe(1);
      expect(await countAssistantTurnsForAccountSince(db, accountId, since)).toBe(1);
    });
  });
});

describe("linkSessionLead", () => {
  it("attaches the submission and contact the conversation produced", async () => {
    await withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Assistant Leads" }, "user_test");
      const assistant = await createAssistant(db, accountId, { form_id: form.id });
      const { id: sessionId } = await createAssistantSession(db, {
        assistantId: assistant.id, accountId, ipHash: randomIpHash(), locale: "en", pageUrl: null,
      });

      const submission = await createSubmission(db, accountId, form.id, {
        answers: [{ key: "first_name", label: "First name", value: "Dana" }],
        locale: "en",
      });
      const contact = await createContact(db, accountId, { firstName: "Dana" }, "user_test");

      await linkSessionLead(db, sessionId, submission.id, contact.id);

      const session = await getAssistantSession(db, sessionId);
      expect(session?.submission_id).toBe(submission.id);
      expect(session?.contact_id).toBe(contact.id);
    });
  });

  it("accepts a null contact — a lead whose enrichment failed is still a lead", async () => {
    await withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Assistant Leads 2" }, "user_test");
      const assistant = await createAssistant(db, accountId, { form_id: form.id });
      const { id: sessionId } = await createAssistantSession(db, {
        assistantId: assistant.id, accountId, ipHash: randomIpHash(), locale: "en", pageUrl: null,
      });
      const submission = await createSubmission(db, accountId, form.id, {
        answers: [{ key: "first_name", label: "First name", value: "Pat" }],
      });

      await linkSessionLead(db, sessionId, submission.id, null);

      const session = await getAssistantSession(db, sessionId);
      expect(session?.submission_id).toBe(submission.id);
      expect(session?.contact_id).toBeNull();
    });
  });

  it("throws for a session that does not exist rather than silently doing nothing (mutation: drop the `!data?.length` guard -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Assistant Leads 3" }, "user_test");
      const submission = await createSubmission(db, accountId, form.id, {
        answers: [{ key: "first_name", label: "First name", value: "Nobody" }],
      });
      await expect(
        linkSessionLead(db, "00000000-0000-0000-0000-000000000000", submission.id, null),
      ).rejects.toThrow(/linkSessionLead failed: no session/);
    });
  });
});
