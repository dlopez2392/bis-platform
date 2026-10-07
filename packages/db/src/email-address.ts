/**
 * The ledger's email key (consent chain spec §3; 0054's CHECK): trimmed,
 * lowercased, and only when 0054 would accept it — 3 to 254 characters
 * (counted as Postgres counts them, by character) with an "@" after the
 * first character. Null otherwise: there is nothing to key on. Pure. The
 * 0049 fold's SQL applies the same rule (supabase/backfills/0049-fold-write.sql).
 */
export function emailLedgerAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const address = raw.trim().toLowerCase();
  const length = [...address].length;
  if (length < 3 || length > 254) return null;
  if (address.indexOf("@") < 1) return null;
  return address;
}
