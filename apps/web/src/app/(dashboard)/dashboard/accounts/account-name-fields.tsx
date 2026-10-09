"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { m } from "@/lib/messages";

export type AccountNames = { businessName: string; brandName: string; brandEdited: boolean };

export const NAMES_START: AccountNames = { businessName: "", brandName: "", brandEdited: false };

/** Typing the business name copies it into the brand name, until the brand
 *  name has been edited by hand. */
export function typeBusinessName(state: AccountNames, value: string): AccountNames {
  return state.brandEdited
    ? { ...state, businessName: value }
    : { ...state, businessName: value, brandName: value };
}

/** Editing the brand name stops the copying for good. */
export function typeBrandName(state: AccountNames, value: string): AccountNames {
  return { ...state, brandName: value, brandEdited: true };
}

/**
 * Add company's two names (owner decision 2026-10-09). "Business name" is the
 * agency's private label (`accounts.name`); "Name their customers see" is
 * `brand_name`, and the Clerk organisation is created under it, since Clerk's
 * invitation emails carry that name to the client (D-005). Pre-filled from the
 * business name as it is typed, so the common case is one field of typing,
 * and a label like "Rio Roofing — trial" only reaches customers if the agency
 * leaves it in both boxes. Both required; createClientAccount re-checks.
 *
 * Its own component so it renders without the Dialog's portal in a test.
 * Values live in state, not the form: the create dialog submits through
 * onSubmit, so a refused create keeps what was typed.
 */
export function AccountNameFields() {
  const [names, setNames] = useState<AccountNames>(NAMES_START);
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="name">{m["accounts.name"]}</Label>
        <Input
          id="name" name="name" required
          value={names.businessName}
          onChange={(e) => setNames((s) => typeBusinessName(s, e.target.value))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="brand-name">{m["accounts.brandName"]}</Label>
        <Input
          id="brand-name" name="brandName" required
          value={names.brandName}
          onChange={(e) => setNames((s) => typeBrandName(s, e.target.value))}
        />
        <p className="text-xs text-muted-foreground">{m["accounts.brandNameHint"]}</p>
      </div>
    </>
  );
}
