/**
 * The calendar's "Notify these addresses" field, as a list (D-034).
 *
 * Commas, semicolons and new lines all separate: the forms editor and the
 * weekly-report field ask for commas, Outlook pastes semicolons, and this
 * textarea has always been seeded one per line. Before this the server split
 * on new lines only, so "a@x.com, b@y.com" was stored as ONE address no mail
 * server accepts.
 *
 * A plain module, not `actions.ts` ("use server" files export async
 * functions only), so the settings form computes its "nobody will be
 * notified" warning from the SAME split the save uses.
 */
export function parseNotifyEmails(raw: string): string[] {
  return raw.split(/[,;\r\n]+/).map((s) => s.trim()).filter(Boolean);
}
