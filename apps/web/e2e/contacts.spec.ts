import { test, expect } from "@playwright/test";
import { SEEDED_ACCOUNT_NAME, openAccountByName } from "./support";

test("contacts table renders and sorts", async ({ page }) => {
  // `a[href*="/contacts"]' is not unambiguous: it's a substring match, and
  // nothing on the page guarantees the first such anchor is a company card
  // rather than some other future link that merely mentions "/contacts" in
  // its href. Positional `.first()` on the company cards has the same
  // problem one level up: it picks whichever account renders first, which
  // is only the seeded account by accident of it currently being the only
  // one. Target the seeded account explicitly by name instead — this spec
  // needs its contact (Maria Garcia) to exist, not just any company.
  await openAccountByName(page, SEEDED_ACCOUNT_NAME);
  await expect(page).toHaveURL(/\/contacts$/);

  const table = page.getByRole("table");
  await expect(table).toBeVisible();

  const nameHeader = page.getByRole("button", { name: /Contact name/ });
  await nameHeader.click();
  await expect(table).toBeVisible();

  // Review finding: `toggleSort` is a real `router.push` now, not local
  // `setState` — a navigation that re-renders the Server Component tree
  // (see use-peek.ts's own comment on exactly this). Keyboard users must
  // not be dumped back to the top of the document mid-task: the clicked
  // header button itself should still hold focus once the sort lands, the
  // same way `aria-sort` on its `<th>` is preserved and already asserted
  // elsewhere. `nameHeader` re-resolves against the live DOM, so this checks
  // the CURRENT button (post-navigation), not a stale reference to the one
  // that existed before the click.
  await expect(nameHeader).toBeFocused();
});
