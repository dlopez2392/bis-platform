/** Spec 3.1: the shim fetches only a signed GET on the documents bucket, at the caller's own origin. */
export const OBJECT_PREFIX = "/storage/v1/object/sign/documents/";

export function allowedObjectUrl(raw, origin) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.origin !== origin || u.username !== "" || u.password !== "") return false;
  // The URL parser resolves "..", "." and their %2e forms before this check, but it does NOT decode
  // an encoded slash or backslash (%2F, %5C): a path carrying either could be decoded into another
  // directory further along, so it is refused outright. Real object paths are account/document/version
  // uuids and never contain one.
  if (/%2f|%5c/i.test(u.pathname)) return false;
  if (!u.pathname.startsWith(OBJECT_PREFIX) || u.pathname.length === OBJECT_PREFIX.length) return false;
  return u.searchParams.has("token");
}
