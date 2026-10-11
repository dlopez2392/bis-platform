import { describe, it, expect } from "vitest";
import { relationshipsLoadFrom } from "./relationships-load";

const VIEW = { id: "r1", labelKey: "parent", customLabel: null, namedSide: "a", person: null, namedForm: null, subjectForm: null,
  canPickUp: false, isEmergency: false, lockedFlag: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("relationshipsLoadFrom", () => {
  it("a 200 with a subject and views is ready", async () => {
    expect(await relationshipsLoadFrom(json({ subject: { firstName: "Sofía", lastName: null }, views: [VIEW] })))
      .toEqual({ status: "ready", subject: { firstName: "Sofía", lastName: null }, views: [VIEW] });
  });
  it("anything else is the card's error state (mutation: trust any 200 body -> FAILS)", async () => {
    expect(await relationshipsLoadFrom(json({}, 500))).toEqual({ status: "error" });
    expect(await relationshipsLoadFrom(json({ views: "nope" }))).toEqual({ status: "error" });
    expect(await relationshipsLoadFrom(json({ subject: {}, views: [{ ...VIEW, labelKey: "cousin" }] }))).toEqual({ status: "error" });
    expect(await relationshipsLoadFrom(new Response("not json", { status: 200 }))).toEqual({ status: "error" });
  });
  it("a person whose name is not text is the error state, never a chip that throws in render (mutation: check only person.id -> FAILS)", async () => {
    const person = { id: "22222222-2222-4222-8222-222222222222", firstName: 7, lastName: null };
    expect(await relationshipsLoadFrom(json({ subject: {}, views: [{ ...VIEW, person }] }))).toEqual({ status: "error" });
  });
});
