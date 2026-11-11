// apps/web/src/lib/owner-line/names.ts
/** The first word of a stored name, for "Hi Dan" and "Owner line · Dan". Null for no name or a blank one. */
export function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}
