import { describe, it, expect } from "vitest";
import { emailKey } from "@bis/db";
import {
  nameWords, nameMatch, nameMatches, nameHits, spokenEmail, spokenEmailKey, candidateOf, decideIdentity,
  type Candidate,
} from "./match";

describe("nameWords", () => {
  it("lowercases, strips accents and apostrophes, splits on everything else, and trims", () => {
    expect(nameWords("María Elena García López")).toEqual(["maria", "elena", "garcia", "lopez"]);
    expect(nameWords("O'Brien García-López Muñoz")).toEqual(["obrien", "garcia", "lopez", "munoz"]);
    expect(nameWords("  José   ")).toEqual(["jose"]);
  });
});

describe("nameMatch / nameMatches — spec 5.3 rules 1-4", () => {
  // The record: first_name "María Elena", last_name "García López".
  const record = nameWords("María Elena García López");

  it("rule-abiding spoken names match", () => {
    expect(nameMatches(nameWords("María García"), record)).toBe(true);
    expect(nameMatches(nameWords("María Elena García"), record)).toBe(true);
    expect(nameMatches(nameWords("María García López"), record)).toBe(true);
    expect(nameMatches(nameWords("maria lopez"), record)).toBe(true);
  });

  it("rule 2 (first word must agree): 'Elena García' does not match", () => {
    expect(nameMatches(nameWords("Elena García"), record)).toBe(false);
  });

  it("rule 3 (every spoken word must be on record): 'María García Pérez' does not match", () => {
    expect(nameMatches(nameWords("María García Pérez"), record)).toBe(false);
  });

  it("rule 3's own probe (P5): 'María López García' does not match (mutation: match by set membership instead of order -> FAILS)", () => {
    // Every WORD of "María López García" is present in the record's set
    // ("maria", "lopez", "garcia" are all on record), but not in the
    // record's ORDER — a set-membership check would wrongly accept this.
    expect(nameMatches(nameWords("María López García"), record)).toBe(false);
  });

  it("rule 4's own probe (P5): a spoken name ending on a particle does not match, but the particle's object does", () => {
    const deLaCruz = nameWords("María de la Cruz");
    expect(nameMatches(nameWords("María de"), deLaCruz)).toBe(false);
    expect(nameMatches(nameWords("María Cruz"), deLaCruz)).toBe(true);
  });

  it("the voice-created split ('María García' / 'López', registry.ts:444-446) is matched by 'María López'", () => {
    const words = nameWords("María García López"); // first_name "María García", last_name "López"
    expect(nameMatches(nameWords("María López"), words)).toBe(true);
  });

  it("rule 1: both names need two words or more — a one-word record or a 'Caller' placeholder never matches", () => {
    const dan = nameWords("Dan "); // first_name "Dan", last_name null
    expect(nameMatches(nameWords("Dan Lopez"), dan)).toBe(false);
    const caller = nameWords("Caller "); // the shared-number placeholder
    expect(nameMatches(nameWords("Caller Prueba"), caller)).toBe(false);
    expect(nameMatches(nameWords("Dan Lopez"), caller)).toBe(false);
  });

  it("nameMatch kinds (P26): exact vs partial", () => {
    const full = nameWords("María Elena García López");
    expect(nameMatch(full, full)).toBe("exact");
    expect(nameMatch(nameWords("María García"), full)).toBe("partial");
    // every record word spoken, in order (mutation: drop the record-in-spoken direction -> FAILS)
    const sole = nameWords("María García");
    expect(nameMatch(nameWords("María García López"), sole)).toBe("partial");
  });

  it("whole words only, never a prefix: \"Ana Gar\" is not \"Ana Garcia\" (T17 review M1; mutation: `w === a[i]` -> `w.startsWith(a[i])` in inOrder -> partial, FAILS)", () => {
    expect(nameMatch(["ana", "gar"], ["ana", "garcia"])).toBeNull();
    expect(nameMatch(nameWords("Ana Gar"), nameWords("Ana García"))).toBeNull();
  });

  it("nameHits prefers the exact hits over the partial ones (P26)", () => {
    const father: Candidate = { id: "father", words: nameWords("José Luis Garza"), emailKey: null };
    const son: Candidate = { id: "son", words: nameWords("José Garza"), emailKey: null };
    // mutation: pool exact and partial together -> "José Garza" would hit both, FAILS
    expect(nameHits(nameWords("José Garza"), [father, son])).toEqual([son]);
    expect(nameHits(nameWords("José Luis Garza"), [father, son])).toEqual([father]);

    const ana1: Candidate = { id: "a1", words: nameWords("Ana María Prueba"), emailKey: null };
    const ana2: Candidate = { id: "a2", words: nameWords("Ana Lucía Prueba"), emailKey: null };
    expect(nameHits(nameWords("Ana Prueba"), [ana1, ana2])).toEqual([ana1, ana2]);
  });
});

describe("spokenEmail", () => {
  it("English and Spanish spelled-out addresses", () => {
    expect(spokenEmail("ana dot garcia at gmail dot com")).toBe("ana.garcia@gmail.com");
    expect(spokenEmail("ana punto garcia arroba gmail punto com")).toBe("ana.garcia@gmail.com");
  });

  it("whitespace and case are collapsed", () => {
    expect(spokenEmail("A N A @ x . com")).toBe("ana@x.com");
  });

  it("underscore words", () => {
    expect(spokenEmail("ana guion bajo garcia arroba gmail punto com")).toBe("ana_garcia@gmail.com");
    expect(spokenEmail("ana guión bajo b arroba x punto com")).toBe("ana_b@x.com");
  });

  it("plus words, English and Spanish", () => {
    expect(spokenEmail("ana plus bis at gmail dot com")).toBe("ana+bis@gmail.com");
    expect(spokenEmail("ana más bis arroba gmail punto com")).toBe("ana+bis@gmail.com");
  });

  it("the dash words (P28), each its own case (mutation: read 'guion' before the pairs -> 'ana-bajob@x.com' FAILS)", () => {
    expect(spokenEmail("ana guion medio b arroba x punto com")).toBe("ana-b@x.com");
    expect(spokenEmail("ana guión b arroba x punto com")).toBe("ana-b@x.com");
    expect(spokenEmail("ana guion bajo b arroba x punto com")).toBe("ana_b@x.com");
    expect(spokenEmail("ana raya b arroba x punto com")).toBe("ana-b@x.com");
  });

  it("an address already carrying '@' is never word-mapped", () => {
    expect(spokenEmail("dottie@x.com")).toBe("dottie@x.com");
  });

  it("not shaped like an email reads as null", () => {
    expect(spokenEmail("ana at gmail")).toBeNull();
  });
});

describe("spokenEmailKey", () => {
  it("is the same key function as @bis/db's emailKey (parity: the one rule, never a copy)", () => {
    expect(spokenEmailKey("Ana+bis@Gmail.com")).toBe("ana@gmail.com");
    for (const addr of [
      "Ana+bis@Gmail.com", "dan@example.com", "  dan@example.com  ", "DAN@EXAMPLE.COM", "a.b+c@x.co",
    ]) {
      expect(spokenEmailKey(addr)).toBe(emailKey(addr));
    }
  });
});

describe("decideIdentity — spec 5.3's table, amended (P25, P26)", () => {
  const ana: Candidate = { id: "ana", words: nameWords("Ana Prueba"), emailKey: "ana@x.com" };
  const beto: Candidate = { id: "beto", words: nameWords("Beto Prueba"), emailKey: null };

  it("no candidates on the number -> none", () => {
    expect(decideIdentity({ candidates: [], truncated: false, required: 1 })).toEqual({ kind: "none" });
  });

  it("truncated -> cannot, whatever the candidates", () => {
    expect(decideIdentity({ candidates: [ana], truncated: true, required: 1 })).toEqual({
      kind: "cannot_on_this_call",
    });
  });

  it("rung 1, one candidate, no name given -> confirmed by caller id", () => {
    expect(decideIdentity({ candidates: [ana], truncated: false, required: 1 })).toEqual({
      kind: "confirmed", contactId: "ana", rung: 1, by: "caller_id",
    });
  });

  it("rung 1, one candidate, a name that does not agree -> miss (P25)", () => {
    expect(decideIdentity({
      candidates: [ana], truncated: false, required: 1, fullName: "Carla Prueba",
    })).toEqual({ kind: "miss" });
  });

  it("rung 1, one candidate, the matching name -> confirmed by name", () => {
    expect(decideIdentity({
      candidates: [ana], truncated: false, required: 1, fullName: "Ana Prueba",
    })).toEqual({ kind: "confirmed", contactId: "ana", rung: 1, by: "name" });
  });

  it("rung 1, one candidate, a name that is only a prefix of the record's -> miss, never confirmed (T17 review M1)", () => {
    const garcia: Candidate = { id: "garcia", words: nameWords("Ana Garcia"), emailKey: null };
    expect(decideIdentity({
      candidates: [garcia], truncated: false, required: 1, fullName: "Ana Gar",
    })).toEqual({ kind: "miss" });
  });

  it("rung 1, one candidate, a one-word name -> ask_name", () => {
    expect(decideIdentity({
      candidates: [ana], truncated: false, required: 1, fullName: "Ana",
    })).toEqual({ kind: "ask_name" });
  });

  it("rung 2, no email on any candidate -> cannot", () => {
    expect(decideIdentity({ candidates: [beto], truncated: false, required: 2 })).toEqual({
      kind: "cannot_on_this_call",
    });
  });

  it("a one-word name -> ask_name (independent of rung)", () => {
    expect(decideIdentity({
      candidates: [ana], truncated: false, required: 2, fullName: "Ana",
    })).toEqual({ kind: "ask_name" });
  });

  it("rung 2, a full name but no email given -> ask_email", () => {
    expect(decideIdentity({
      candidates: [ana], truncated: false, required: 2, fullName: "Ana Prueba",
    })).toEqual({ kind: "ask_email" });
  });

  it("rung 2, a malformed email -> ask_email", () => {
    expect(decideIdentity({
      candidates: [ana], truncated: false, required: 2, fullName: "Ana Prueba", email: "ana at x",
    })).toEqual({ kind: "ask_email" });
  });

  it("rung 1, two candidates, the name picks exactly one -> confirmed rung 1 by name", () => {
    expect(decideIdentity({
      candidates: [ana, beto], truncated: false, required: 1, fullName: "Ana Prueba",
    })).toEqual({ kind: "confirmed", contactId: "ana", rung: 1, by: "name" });
  });

  it("rung 1, two candidates, the name matches neither -> miss", () => {
    expect(decideIdentity({
      candidates: [ana, beto], truncated: false, required: 1, fullName: "Carla Prueba",
    })).toEqual({ kind: "miss" });
  });

  describe("the same-name pair (two 'Ana Prueba')", () => {
    const a1: Candidate = { id: "a1", words: nameWords("Ana Prueba"), emailKey: "ana@x.com" };
    const a2: Candidate = { id: "a2", words: nameWords("Ana Prueba"), emailKey: "ana2@x.com" };

    it("no email given -> ask_email", () => {
      expect(decideIdentity({
        candidates: [a1, a2], truncated: false, required: 1, fullName: "Ana Prueba",
      })).toEqual({ kind: "ask_email" });
    });

    it("the matching email -> confirmed a2, rung 2, by name_email", () => {
      expect(decideIdentity({
        candidates: [a1, a2], truncated: false, required: 1, fullName: "Ana Prueba", email: "ana2@x.com",
      })).toEqual({ kind: "confirmed", contactId: "a2", rung: 2, by: "name_email" });
    });

    it("an email that matches neither -> miss", () => {
      expect(decideIdentity({
        candidates: [a1, a2], truncated: false, required: 1, fullName: "Ana Prueba", email: "zed@x.com",
      })).toEqual({ kind: "miss" });
    });

    it("neither candidate has an email at all -> miss, never ask_email", () => {
      const b1: Candidate = { id: "b1", words: nameWords("Ana Prueba"), emailKey: null };
      const b2: Candidate = { id: "b2", words: nameWords("Ana Prueba"), emailKey: null };
      expect(decideIdentity({
        candidates: [b1, b2], truncated: false, required: 1, fullName: "Ana Prueba",
      })).toEqual({ kind: "miss" });
    });
  });

  it("rung 2, name and email together match exactly one -> confirmed rung 2", () => {
    expect(decideIdentity({
      candidates: [ana, beto], truncated: false, required: 2, fullName: "Ana Prueba", email: "ana@x.com",
    })).toEqual({ kind: "confirmed", contactId: "ana", rung: 2, by: "name_email" });
  });

  it("rung 2, two records matching name AND email -> miss (S4)", () => {
    const a1: Candidate = { id: "a1", words: nameWords("Ana Prueba"), emailKey: "ana@x.com" };
    const a2: Candidate = { id: "a2", words: nameWords("Ana Prueba"), emailKey: "ana@x.com" };
    expect(decideIdentity({
      candidates: [a1, a2], truncated: false, required: 2, fullName: "Ana Prueba", email: "ana@x.com",
    })).toEqual({ kind: "miss" });
  });
});

describe("candidateOf", () => {
  it("builds a Candidate's words from first_name + last_name and carries email_key through", () => {
    expect(candidateOf({ id: "c1", first_name: "Ana", last_name: "Prueba", email_key: "ana@x.com" })).toEqual({
      id: "c1", words: ["ana", "prueba"], emailKey: "ana@x.com",
    });
    expect(candidateOf({ id: "c2", first_name: "Dan", last_name: null, email_key: null })).toEqual({
      id: "c2", words: ["dan"], emailKey: null,
    });
  });
});
