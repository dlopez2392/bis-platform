import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenedRef } from "@bis/db";

const noteAgencyOpen = vi.fn();
const authMock = vi.fn();
const requestHeaders = vi.hoisted(() => ({ value: {} as Record<string, string> }));
const SVC = { service: true };

vi.mock("@bis/db", () => ({
  serviceDb: () => SVC,
  noteAgencyOpen: (...a: unknown[]) => noteAgencyOpen(...a),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(requestHeaders.value) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import { noteOpened, noteOpenedApi } from "./note";
import { enterHref } from "./paths";

const A = "11111111-1111-4111-8111-111111111111";
const CONTACT: OpenedRef = { kind: "contact", recordId: "33333333-3333-4333-8333-333333333333" };
const EXPORT: OpenedRef = { kind: "customer_list_export", itemCount: 42 };
const AGENCY = { isAgency: true };
const CLIENT = { isAgency: false };

beforeEach(() => {
  noteAgencyOpen.mockReset();
  authMock.mockReset();
  authMock.mockResolvedValue({ userId: "user_agency", sessionId: "sess_1" });
  requestHeaders.value = {};
});

/** F-118 part 1 (spec 4.2): the one place a record open is written. */
describe("a client is never logged and pays nothing", () => {
  it("1. noteOpened resolves and noteOpenedApi answers true, with no auth() call and no RPC (mutation: call the RPC for clients -> FAILS)", async () => {
    await expect(noteOpened(CLIENT, A, CONTACT)).resolves.toBeUndefined();
    expect(await noteOpenedApi(CLIENT, A, CONTACT)).toBe(true);
    expect(authMock).not.toHaveBeenCalled();
    expect(noteAgencyOpen).not.toHaveBeenCalled();
  });
});

describe("the agency's open is written to its live visit", () => {
  it.each([["a contact", CONTACT], ["a customer-list download", EXPORT]] as const)(
    "2. %s: written for this account, person and session, the ref passed through unchanged", async (_label, ref) => {
      noteAgencyOpen.mockResolvedValue("ok");
      await expect(noteOpened(AGENCY, A, ref)).resolves.toBeUndefined();
      expect(noteAgencyOpen).toHaveBeenLastCalledWith(SVC, A, { clerkUserId: "user_agency", sessionId: "sess_1" }, ref);
      expect(await noteOpenedApi(AGENCY, A, ref)).toBe(true);
      expect(noteAgencyOpen).toHaveBeenLastCalledWith(SVC, A, { clerkUserId: "user_agency", sessionId: "sess_1" }, ref);
    });

  it("3. no live visit: noteOpened sends the person to the chooser with the path they asked for; noteOpenedApi answers false", async () => {
    noteAgencyOpen.mockResolvedValue("no_visit");
    const path = `/dashboard/accounts/${A}/contacts/c1`;
    requestHeaders.value = { "x-bis-path": path };
    await expect(noteOpened(AGENCY, A, CONTACT)).rejects.toThrow(`REDIRECT:${enterHref(A, path)}`);
    expect(await noteOpenedApi(AGENCY, A, CONTACT)).toBe(false);
  });

  it("3. a header naming another account is dropped: the bare chooser", async () => {
    noteAgencyOpen.mockResolvedValue("no_visit");
    requestHeaders.value = { "x-bis-path": "/dashboard/accounts/22222222-2222-4222-8222-222222222222/contacts" };
    await expect(noteOpened(AGENCY, A, CONTACT)).rejects.toThrow(new RegExp(`^REDIRECT:/dashboard/enter/${A}$`));
  });

  it("4. a failed write rejects noteOpened (owner ruling 4: fail closed; mutation: catch { return; } -> FAILS)", async () => {
    const boom = new Error("noteAgencyOpen failed: down");
    noteAgencyOpen.mockRejectedValue(boom);
    await expect(noteOpened(AGENCY, A, CONTACT)).rejects.toBe(boom);
  });
  it("4. a failed write rejects noteOpenedApi, never true and never false (mutation: catch { return; } -> FAILS)", async () => {
    const boom = new Error("noteAgencyOpen failed: down");
    noteAgencyOpen.mockRejectedValue(boom);
    await expect(noteOpenedApi(AGENCY, A, CONTACT)).rejects.toBe(boom);
  });

  it("5. no session id: noteOpenedApi answers false with no RPC, and noteOpened sends the person to the chooser", async () => {
    authMock.mockResolvedValue({ userId: "user_agency", sessionId: null });
    expect(await noteOpenedApi(AGENCY, A, CONTACT)).toBe(false);
    await expect(noteOpened(AGENCY, A, CONTACT)).rejects.toThrow(`REDIRECT:/dashboard/enter/${A}`);
    expect(noteAgencyOpen).not.toHaveBeenCalled();
  });
});
