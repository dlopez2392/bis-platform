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
    const service = {} as never; // isUserClient(service) is false
    expect(() => requireAuthor(service, undefined, "updateContact")).toThrow(/updateContact: a server write must say who made it/);
  });

  it("requireAuthor returns the author unchanged on a service client (mutation: return a different object -> FAILS)", () => {
    const service = {} as never;
    const author = { authorKind: "ai", authorId: null } as const;
    expect(requireAuthor(service, author, "updateContact")).toBe(author);
  });

  it("requireAuthor never refuses a user client with no author (mutation: throw unconditionally -> FAILS)", () => {
    const USER_CLIENT = Symbol.for("@bis/db:user-client");
    const user = { [USER_CLIENT]: true } as unknown as never;
    expect(requireAuthor(user, undefined, "updateContact")).toBeUndefined();
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
});

