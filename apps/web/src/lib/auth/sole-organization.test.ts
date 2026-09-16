import { describe, it, expect } from "vitest";
import { soleOrganizationToActivate } from "./sole-organization";

const base = {
  signedIn: true,
  activeOrgId: null as string | null | undefined,
  memberships: [] as { organizationId: string }[],
};

describe("soleOrganizationToActivate", () => {
  /**
   * The case this exists for: an invited client, signed in, belonging to the
   * one company that invited them, with no active organization — so no
   * `org_id` claim, and every guard treats them as belonging to nothing.
   */
  it("activates the one organization an invited client belongs to", () => {
    expect(
      soleOrganizationToActivate({ ...base, memberships: [{ organizationId: "org_woodworks" }] }),
    ).toBe("org_woodworks");
  });

  it("leaves a session that already has an active organization alone", () => {
    expect(
      soleOrganizationToActivate({
        ...base,
        activeOrgId: "org_already",
        memberships: [{ organizationId: "org_woodworks" }],
      }),
    ).toBeNull();
  });

  it("does nothing for a user who belongs to nothing", () => {
    // Genuinely unlinked. The no-access screen is the right answer, and
    // inventing an organization for them would be the wrong one.
    expect(soleOrganizationToActivate({ ...base, memberships: [] })).toBeNull();
  });

  /**
   * The safety property that lets this be mounted app-wide.
   *
   * `createClientAccount` passes `createdBy`, so the agency admin is a member
   * of every client organization it creates. If this picked the first of
   * several, the agency would be silently dropped into a client's
   * organization on any request where their session had no active org.
   */
  it("refuses to choose when there is more than one", () => {
    expect(
      soleOrganizationToActivate({
        ...base,
        memberships: [
          { organizationId: "org_client_a" },
          { organizationId: "org_client_b" },
        ],
      }),
    ).toBeNull();
  });

  it("does nothing for a signed-out visitor", () => {
    expect(
      soleOrganizationToActivate({
        ...base,
        signedIn: false,
        memberships: [{ organizationId: "org_woodworks" }],
      }),
    ).toBeNull();
  });

  it("treats an undefined active org the same as none", () => {
    // Clerk reports "not loaded / not set" as undefined rather than null, and
    // a user waiting on that must still be activated once it settles.
    expect(
      soleOrganizationToActivate({
        ...base,
        activeOrgId: undefined,
        memberships: [{ organizationId: "org_woodworks" }],
      }),
    ).toBe("org_woodworks");
  });

  it("treats an empty-string active org as none rather than as set", () => {
    expect(
      soleOrganizationToActivate({
        ...base,
        activeOrgId: "",
        memberships: [{ organizationId: "org_woodworks" }],
      }),
    ).toBe("org_woodworks");
  });
});
