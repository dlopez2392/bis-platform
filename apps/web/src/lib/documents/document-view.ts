import type { ListedDocument } from "@bis/db";
import type { DocumentView } from "./documents-load";

/** The author's Clerk id never leaves the server: the card gets "you", a name, or null ("Someone on the team"). */
export function documentView(d: ListedDocument, viewerId: string, names: Readonly<Record<string, string>>): DocumentView {
  const you = d.created_by === viewerId;
  return {
    id: d.id, title: d.title, category: d.category, expiresOn: d.expires_on, ownersOnly: d.owners_only, source: d.source,
    addedBy: { you, name: you ? null : (Object.hasOwn(names, d.created_by) ? names[d.created_by]! : null) },
    createdAt: d.created_at, deletedAt: d.deleted_at,
    version: { id: d.version.id, contentType: d.version.content_type, bytes: d.version.bytes },
  };
}
