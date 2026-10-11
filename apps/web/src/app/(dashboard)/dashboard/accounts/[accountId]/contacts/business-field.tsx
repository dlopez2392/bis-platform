"use client";

import { useState } from "react";
import { InlineField } from "@/components/inline-field";
import { followedFieldKey } from "@/lib/contacts/inline-save";
import { m } from "@/lib/messages";
import { setContactBusinessAction, undoContactBusinessAction, type BusinessUndo } from "./actions";

/**
 * The contact's Business name (S-02 §6 rows 3 and 18): its value is the
 * contact's business group, as the database copies it into company_name; a
 * save links, replaces or unlinks that group, and Undo hands the server back
 * its own record of what it replaced. Each surface wraps this in its own row.
 */
export function BusinessInlineField({ accountId, contactId, value }: { accountId: string; contactId: string; value: string | null }) {
  // Keyed by the value (Task 6 fix round 1, I1): a Groups card write can
  // change the business name under this field, and InlineField ignores a new
  // `value` once mounted, so the refreshed name remounts it. But never while
  // the operator is typing (final review minor 11): the key is held from the
  // moment editing starts, so a refresh mid-edit keeps what they typed.
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState(value ?? "");
  const next = followedFieldKey(editing, key, value);
  if (next !== key) setKey(next);
  return (
    <InlineField
      key={next}
      label={m["contact.company"]}
      field="company_name"
      value={value}
      onEditingChange={setEditing}
      save={(v) => setContactBusinessAction(accountId, contactId, v)}
      undoWith={(payload) => undoContactBusinessAction(accountId, contactId, payload as BusinessUndo)}
    />
  );
}
