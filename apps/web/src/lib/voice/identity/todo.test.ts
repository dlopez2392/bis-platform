import { describe, expect, it } from "vitest";
import { identityTodoTitle } from "./todo";

// S-47e (spec 5.6, S10): the locked call's one To-do, in the ACCOUNT's language. The title is built here, not in
// finish-call.ts, because finish-call.ts is a gate caller and scans.test.ts reads every "voice." literal in a
// gate caller as a send kind.
describe("identityTodoTitle", () => {
  it("is the catalogue's sentence in each language", () => {
    expect(identityTodoTitle("en")).toBe("Someone asked about an appointment and couldn't confirm who they are");
    expect(identityTodoTitle("es")).toBe("Alguien preguntó por una cita y no pudo confirmar quién es");
  });
});
