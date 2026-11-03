import { describe, it, expect } from "vitest";
import { authorHeaderValue, withAuthor, requireAuthor, eventActorOf, AUTHOR_HEADER } from "./row-author";
import { contactAuthor } from "./provenance";
import { updateContact } from "./contacts";

describe("row-author", () => {
  it("serialises kind, id and via (mutation: drop via -> FAILS)", () => {
    expect(JSON.parse(authorHeaderValue({ authorKind: "ai", authorId: null }, "ai_act:a"))).toEqual({ kind: "ai", via: "ai_act:a" });
    expect(JSON.parse(authorHeaderValue({ authorKind: "person", authorId: "user_1" }))).toEqual({ kind: "person", id: "user_1" });
  });

  it("refuses a person with no id (mutation: remove the guard -> FAILS)", () => {
    expect(() => authorHeaderValue({ authorKind: "person", authorId: null })).toThrow(/person author needs an id/);
  });

  it("withAuthor sets exactly the one header (mutation: wrong header name -> FAILS)", () => {
    const calls: [string, string][] = [];
    const b = { setHeader(n: string, v: string) { calls.push([n, v]); return b; } };
    expect(withAuthor(b, { authorKind: "automation", authorId: null })).toBe(b);
    expect(calls).toEqual([[AUTHOR_HEADER, '{"kind":"automation"}']]);
  });

  it("requireAuthor refuses a service client with no author, at runtime (mutation: return undefined -> FAILS)", () => {
    const service = {} as never;
    expect(() => requireAuthor(service, undefined, "updateContact")).toThrow(/updateContact: a server write must say who made it/);
  });

  it("requireAuthor returns the author unchanged on a service client (mutation: return a different object -> FAILS)", () => {
    const service = {} as never;
    const author = { authorKind: "ai", authorId: null } as const;
    expect(requireAuthor(service, author, "updateContact")).toBe(author);
  });

  // Fix round: the user-client exemption was moot (withAuthor would TypeError on an undefined author
  // just as hard on a user client) — requireAuthor now refuses every client the same way, with the
  // writer's own named message, rather than a user client's call surfacing a bare TypeError two lines
  // later instead. Replaces the old "never refuses a user client" case this simplification contradicts.
  it("requireAuthor refuses a user client with no author too, same message, at runtime (mutation: special-case isUserClient back in -> FAILS)", () => {
    const USER_CLIENT = Symbol.for("@bis/db:user-client");
    const user = { [USER_CLIENT]: true } as unknown as never;
    expect(() => requireAuthor(user, undefined, "updateContact")).toThrow(/updateContact: a server write must say who made it/);
  });

  it("requireAuthor returns the author unchanged on a user client too (mutation: return a different object -> FAILS)", () => {
    const USER_CLIENT = Symbol.for("@bis/db:user-client");
    const user = { [USER_CLIENT]: true } as unknown as never;
    const author = { authorKind: "person", authorId: "user_1" } as const;
    expect(requireAuthor(user, author, "updateContact")).toBe(author);
  });

  it("eventActorOf is the inverse of contactAuthor for every pair it produces (mutation: map customer to ai -> FAILS)", () => {
    for (const [t, id] of [
      ["user", "user_1"],
      ["ai", "sofia"],
      ["system", "system"],
      ["system", "system_demo_seed"],
    ] as const) {
      const a = contactAuthor(t, id);
      expect(contactAuthor(eventActorOf(a).actorType, eventActorOf(a).actorId)).toEqual(a);
    }
  });

  // The brief's own prescribed check (`updateContact({} as never, "a", "c", { dnd: true })`, 4 args)
  // is a no-op here either way: `updateContact`'s 5th parameter (actorId today, author after
  // conversion) has never had a default, so a 4-argument call is TS2554 "not enough arguments"
  // BEFORE this task and stays exactly that error AFTER it — the directive is used in both states,
  // so that call can never demonstrate a red-to-green flip. Substituted per working rule 2: a
  // 5-argument call whose 5th argument is a bare actor-id STRING is valid today (that is exactly
  // `updateContact`'s current `actorId: string` parameter) and must become a type error once that
  // parameter is a required `RowAuthor` object instead.
  it("updateContact's final argument is an author object, not a bare actor id (mutation: loosen it back to `string` -> tsc FAILS on the unused directive)", () => {
    // @ts-expect-error a bare string is not a RowAuthor
    void (() => updateContact({} as never, "a", "c", { firstName: "x" }, "actor_1"));
    expect(true).toBe(true);
  });

  // The plan's own prescribed check (substituted per working rule 2: the plan's literal `{ dnd: true }`
  // is not a `ContactInput` field at all — `firstName`/`lastName`/`email`/`phone`/`source`/`custom` are
  // the only ones — so that object produces an excess-property error of its OWN on this line regardless
  // of whether `author` is required, which keeps the directive "used" either way and can never
  // demonstrate the mutation below; verified empirically, not just reasoned about, by actually running
  // this exact mutation against the unmodified `{ dnd: true }` call first, which stayed green). `{
  // firstName: "x" }` is a real, valid field, so the ONLY possible error on this line is the arity one.
  //
  // Vitest's esbuild transform does not type-check — a `// @ts-expect-error` comment is purely a `tsc`
  // directive — so this pins `pnpm --filter @bis/db typecheck`, never a vitest run on its own:
  // `updateContact` takes 5 required arguments today, so a 4-argument call omitting `author` is TS2554
  // ("Expected 5-6 arguments, but got 4"), which the directive suppresses. Making `author` optional (or
  // defaulted) would make this exact call valid, leaving the directive with nothing to suppress — TS2578
  // ("Unused '@ts-expect-error' directive") — and `tsc` fails.
  it("updateContact's author argument is required, not optional (mutation: make author optional -> tsc FAILS on the unused directive)", () => {
    // @ts-expect-error author is required
    void (() => updateContact({} as never, "a", "c", { firstName: "x" }));
    expect(true).toBe(true);
  });

  // F-115 fix: CSV import's interactive wizard runs applyImportBatch on dbForRequest() (a USER
  // client — contact-import.ts's `db`), but stamps every row `{authorKind:"import", authorId:<user>}`
  // (item 8c: an imported value must read as "Import" on the change row, never as the signed-in
  // person's own hand-entry). eventActorOf("import") answers {actorType:"system",...} — correct for
  // the SEED/demo import path, which always runs on serviceDb() — but emit()'s own user-client branch
  // (0053, events.ts) refuses any actorType other than "user" on a user client (the RPC it calls,
  // record_event, takes the actor from the JWT and never reads actorType/actorId at all; the check
  // exists only to catch a caller claiming a client-mismatched actor). updateContact blindly forwarding
  // eventActorOf's "system" therefore throws "a signed-in user's client cannot record a 'system' event"
  // on every row of an interactive re-import, which contact-import/actions.ts's outer catch swallows
  // with no log line, so the wizard never reports a result and the spec's "Added 0, updated N." wait
  // times out. Mutation: let updateContact pass eventActorOf(author).actorType straight to emit with
  // no isUserClient override -> FAILS (throws, since the fake db below is marked as a user client).
  it("updateContact's events-ledger emit matches the client it runs on, even for a non-person author", async () => {
    const USER_CLIENT = Symbol.for("@bis/db:user-client");
    const rpcCalls: [string, unknown][] = [];
    const chain: Record<string, unknown> = {};
    chain.update = () => chain;
    chain.eq = () => chain;
    chain.setHeader = () => chain;
    chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
    const fakeDb = Object.defineProperty(
      {
        from: () => chain,
        rpc: (name: string, params: unknown) => {
          rpcCalls.push([name, params]);
          return Promise.resolve({ error: null });
        },
      },
      USER_CLIENT,
      { value: true },
    ) as never;

    await updateContact(fakeDb, "acct_1", "contact_1", { firstName: "Imported" },
      { authorKind: "import", authorId: "user_1" });

    expect(rpcCalls).toEqual([[
      "record_event",
      { p_account_id: "acct_1", p_type: "contact.updated", p_payload: { contactId: "contact_1", fields: ["firstName"] } },
    ]]);
  });
});

