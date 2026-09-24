import { describe, it, expect } from "vitest";
import { baselineGaps, seedConflicts, type BaselineSnapshot } from "./seed";
import { CI_BASELINE } from "./config";

/**
 * The seed reads the project into a snapshot, decides from it, writes what is
 * missing, then reads again and reports what is STILL missing. The two
 * decisions are pure and live here; the reads and writes are exercised live by
 * ./seed.integration.test.ts (not in `pnpm check`).
 *
 * `baselineGaps` is the post-condition list the runner exits non-zero on — one
 * line per section-2 row of the CI plan that is absent or wrong.
 * `seedConflicts` is what the seed refuses to write through, because the only
 * way to "fix" it would be to rename, move or delete a row it did not make.
 */
const spec = CI_BASELINE;
const ACCOUNT = "00000000-0000-0000-0000-00000000000a";
const SALES = "00000000-0000-0000-0000-00000000000b";
const MARIA = "00000000-0000-0000-0000-00000000000c";

const complete = (over: Partial<BaselineSnapshot> = {}): BaselineSnapshot => ({
  agencyCount: 1,
  bucket: { public: true },
  accountsNamed: [{ id: ACCOUNT, clerk_org_id: spec.clerkOrgId }],
  account: { id: ACCOUNT, name: spec.name },
  pipelines: [{ id: SALES, name: "Sales", stageCount: 5 }],
  contact: { id: MARIA, first_name: "Maria", last_name: "Garcia" },
  field: { id: "f", data_type: "single_select" },
  opportunity: { id: "o", pipeline_id: SALES, contact_id: MARIA },
  phone: { id: "p", account_id: ACCOUNT },
  ...over,
});

const empty: BaselineSnapshot = {
  agencyCount: 1, bucket: { public: true }, accountsNamed: [], account: null,
  pipelines: [], contact: null, field: null, opportunity: null, phone: null,
};

describe("baselineGaps", () => {
  it("finds nothing missing in a complete baseline", () => {
    expect(baselineGaps(complete(), spec)).toEqual([]);
  });

  it("names every missing row on a freshly pushed project", () => {
    expect(baselineGaps(empty, spec)).toEqual([
      'no account named "Test Client One"',
      'no contact maria@example.com (Maria Garcia) on "Test Client One"',
      'no pipeline "Sales" on "Test Client One"',
      'no contact custom field referral_source on "Test Client One"',
      'no opportunity "Deck build" on "Test Client One"',
      'phone number +12105550100 is not on "Test Client One"',
    ]);
  });

  it("names a missing agencies row (0001 seeds it; was the push run?)", () => {
    expect(baselineGaps(complete({ agencyCount: 0 }), spec)).toEqual([
      "no agencies row (0001_tenancy.sql inserts it; has db:push:ci run?)",
    ]);
  });

  it("names a missing logo bucket", () => {
    expect(baselineGaps(complete({ bucket: null }), spec)).toEqual([
      "storage bucket brand-logos is missing (supabase/bootstrap/ci-project.sql creates it)",
    ]);
  });

  it("names a private logo bucket", () => {
    expect(baselineGaps(complete({ bucket: { public: false } }), spec)).toEqual([
      "storage bucket brand-logos is not public (logos render to anonymous visitors)",
    ]);
  });

  it("names a duplicated account name, which breaks e2e's .single() lookup", () => {
    expect(baselineGaps(complete({
      accountsNamed: [{ id: ACCOUNT, clerk_org_id: spec.clerkOrgId }, { id: "x", clerk_org_id: "org_other" }],
    }), spec)).toEqual(['2 accounts are named "Test Client One" (client-access.spec reads it with .single())']);
  });

  it("names the account when it sits under another org id", () => {
    expect(baselineGaps(complete({
      accountsNamed: [{ id: "x", clerk_org_id: "org_other" }], account: null,
    }), spec)).toContain('account "Test Client One" has org id org_other, expected org_3H2aweJ6b2GRZghk3DCrNDmrMXU');
  });

  it("names a contact at the address but under another name", () => {
    expect(baselineGaps(complete({ contact: { id: MARIA, first_name: "Mary", last_name: "Garcia" } }), spec))
      .toEqual(['contact maria@example.com is named "Mary Garcia", expected "Maria Garcia"']);
  });

  it("names a Sales pipeline with fewer than two stages (pipeline.spec drags between columns)", () => {
    expect(baselineGaps(complete({ pipelines: [{ id: SALES, name: "Sales", stageCount: 1 }] }), spec))
      .toEqual(['pipeline "Sales" has 1 stage; pipeline.spec needs more than one']);
  });

  it("names a pipeline that is not called Sales, and the opportunity that is therefore not on Sales", () => {
    expect(baselineGaps(complete({ pipelines: [{ id: SALES, name: "Jobs", stageCount: 5 }] }), spec)).toEqual([
      'no pipeline "Sales" on "Test Client One"',
      'opportunity "Deck build" is not on pipeline "Sales"',
    ]);
  });

  it("names a referral field of the wrong type", () => {
    expect(baselineGaps(complete({ field: { id: "f", data_type: "text" } }), spec))
      .toEqual(["custom field referral_source is text, expected single_select"]);
  });

  it("names an opportunity on another pipeline", () => {
    expect(baselineGaps(complete({ opportunity: { id: "o", pipeline_id: "elsewhere", contact_id: MARIA } }), spec))
      .toEqual(['opportunity "Deck build" is not on pipeline "Sales"']);
  });

  it("names an opportunity that is not Maria's", () => {
    expect(baselineGaps(complete({ opportunity: { id: "o", pipeline_id: SALES, contact_id: "someone" } }), spec))
      .toEqual(['opportunity "Deck build" is not for maria@example.com']);
  });

  it("names the number when another account holds it", () => {
    expect(baselineGaps(complete({ phone: { id: "p", account_id: "another" } }), spec))
      .toEqual(['phone number +12105550100 is not on "Test Client One"']);
  });
});

describe("seedConflicts", () => {
  it("has none on a freshly pushed project", () => {
    expect(seedConflicts(empty, spec)).toEqual([]);
  });

  it("has none once the baseline is complete (the second run)", () => {
    expect(seedConflicts(complete(), spec)).toEqual([]);
  });

  it("refuses to rename the account its org id already holds", () => {
    expect(seedConflicts(complete({ account: { id: ACCOUNT, name: "Renamed Co" } }), spec)).toEqual([
      'org org_3H2aweJ6b2GRZghk3DCrNDmrMXU already holds account "Renamed Co"; ci:seed will not rename it',
    ]);
  });

  it("refuses to create a second account with the seeded name", () => {
    expect(seedConflicts({ ...empty, accountsNamed: [{ id: "x", clerk_org_id: "org_other" }] }, spec)).toEqual([
      'an account named "Test Client One" already exists under org org_other; ci:seed will not create a second',
    ]);
  });

  it("refuses to take a number another account holds", () => {
    expect(seedConflicts(complete({ phone: { id: "p", account_id: "another" } }), spec)).toEqual([
      "phone number +12105550100 belongs to another account; ci:seed will not move it",
    ]);
  });

  it("refuses to take a number held before the account even exists", () => {
    expect(seedConflicts({ ...empty, phone: { id: "p", account_id: "another" } }, spec)).toEqual([
      "phone number +12105550100 belongs to another account; ci:seed will not move it",
    ]);
  });
});
