// apps/web/src/lib/owner-line/data-path.ts
// THE ONE PLACE the Task 0 decision lives (docs/superpowers/specs/2026-11-09-owner-line-spike.md; decided by the
// owner on 2026-11-09, plan O-1: "F2 now, T later"). Only `ownerLineReadClient` (./reader.ts) branches on
// OWNER_LINE_DATA_PATH; the setup card, the setup actions and the answer route read OWNER_LINE_ROLES.
// "token": reads run as the person through a minted token, RLS decides, Technicians included. "service" (F2, plan
// SC-2): service-role reads scoped to the account, which equal what an Owner or Staff member sees; a Technician is
// not offered the owner line, because their scope lives only in RLS. T later is a one-line flip of the line below
// to "token", after the import-then-rotate on bis-ci and production (plan, O-1 DECIDED).
// Imports @bis/db for types only: the TeXML routes import this file statically (SC-18).
import type { AccountRole } from "@bis/db";

export type OwnerLineDataPath = "token" | "service";
// `as`, not a `: OwnerLineDataPath` annotation: a const narrows to its literal, and the comparison below would then
// be a type error (TS2367) for whichever value is NOT written here.
export const OWNER_LINE_DATA_PATH = "service" as OwnerLineDataPath;
export const OWNER_LINE_ROLES: readonly AccountRole[] =
  OWNER_LINE_DATA_PATH === "token" ? ["owner", "staff", "technician"] : ["owner", "staff"];
