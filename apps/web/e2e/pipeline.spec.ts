import { test, expect } from "@playwright/test";
import { SEEDED_ACCOUNT_NAME, openAccountByName } from "./support";

// Two full drag round-trips, each ending in a reload against the shared
// Supabase project, and each gesture now retried up to three times (see
// `attemptDrag`). Playwright's 30s default was already the ceiling this spec
// kept hitting; the retries need headroom that does not come out of the same
// budget the work itself needs.
test.describe.configure({ timeout: 90_000 });

test("dragging an opportunity persists after reload", async ({ page }) => {
  // This spec needs an account with a real opportunity to drag, not just
  // any company — a positional `.first()` over the account cards picked
  // whichever one rendered first, which landed on an empty account (no
  // opportunity cards, nothing to drag) once stray empty accounts existed
  // alongside the seeded one. Target the seeded account explicitly by name;
  // openAccountByName FAILS, naming `ci:seed`, if it isn't present rather
  // than silently continuing against the wrong account.
  await openAccountByName(page, SEEDED_ACCOUNT_NAME);
  await page.getByRole("link", { name: "Opportunities" }).click();
  await expect(page).toHaveURL(/\/pipeline$/);

  const columns = page.locator("div.w-72");
  await expect(columns.first()).toBeVisible();
  const columnCount = await columns.count();
  expect(columnCount).toBeGreaterThan(1);

  const card = page.locator('[data-testid^="opp-"]').first();
  await expect(card).toBeVisible();
  const cardId = await card.getAttribute("data-testid");

  async function findColumnIndex(): Promise<number> {
    for (let i = 0; i < columnCount; i++) {
      if (await columns.nth(i).locator(`[data-testid="${cardId}"]`).count()) {
        return i;
      }
    }
    throw new Error(`Could not find a column containing ${cardId}`);
  }

  /** How many times one drag gesture may be attempted before giving up. */
  const DRAG_ATTEMPTS = 3;

  /**
   * ONE drag gesture. Returns whether the card actually landed in `toColumn`.
   *
   * dnd-kit's PointerSensor only starts a drag once the pointer has travelled
   * past a 6px activation distance, and it measures that on the main thread.
   * A re-render landing between `mouse.down()` and the first `mouse.move()`
   * eats the activation and the drop silently never happens — since the
   * Phase-2 shell, every account-route load fires two background
   * server-action POSTs from the sidebar (unread count + setup meter), which
   * is the usual culprit.
   *
   * That used to be guarded by `waitForLoadState("networkidle")` before the
   * gesture. It is a PROXY for "the main thread is quiet", not a measure of
   * it, and Playwright discourages it for exactly this reason: an App Router
   * page with RSC link prefetching offers no guaranteed 500ms of network
   * silence to wait for. It duly became the flake it was added to prevent —
   * CI run 35128151154 parked a 30s test timeout on that line, while the same
   * product code had passed this spec minutes earlier on the previous run of
   * the same branch.
   *
   * Retrying the gesture tests the real property instead of a stand-in for
   * it: either the card moved or it did not, and a missed activation costs
   * one more attempt rather than the whole run. Nothing here is skipped,
   * loosened or tolerated — a card that never lands after three honest
   * gestures still fails the spec.
   */
  async function attemptDrag(
    toColumn: ReturnType<typeof columns.nth>,
    draggedCard: ReturnType<typeof columns.nth>,
    landed: ReturnType<typeof columns.nth>,
  ): Promise<boolean> {
    // A previous attempt may have succeeded while its own verdict was still
    // being measured. Checking first keeps a retry from measuring a source
    // card that is legitimately gone.
    if (await landed.count()) return true;

    // The board is horizontally scrollable (overflow-x-auto) and can have
    // more columns than fit in the viewport. Scroll the destination into
    // view *before* measuring anything — bounding boxes captured before a
    // scroll are stale and yield off-screen coordinates that dnd-kit's
    // pointer sensor can't turn into a valid drop.
    //
    // Center it rather than using scrollIntoViewIfNeeded()'s "minimum
    // distance" behavior: that only scrolls enough to satisfy its own
    // visibility check, which can leave the immediately-adjacent source
    // column clipped outside the actual scrolled viewport even though
    // Playwright's toBeVisible() still calls it visible (that assertion
    // checks CSS visibility, not scroll-clipping). Centering the target
    // leaves ~500px of margin on either side in a standard viewport —
    // comfortably more than the ~304px column width — so the adjacent
    // source column stays on screen too.
    await toColumn.evaluate((el) => el.scrollIntoView({ inline: "center", block: "nearest" }));
    // 5s rather than the project's 10s expect default: three attempts each
    // paying the full default, twice over for the round trip, would spend
    // the whole 90s budget waiting and report a timeout instead of the far
    // more useful "never landed after 3 attempts".
    await expect(draggedCard).toBeVisible({ timeout: 5_000 });

    const cardBox = await draggedCard.boundingBox();
    const targetBox = await toColumn.boundingBox();
    if (!cardBox || !targetBox) throw new Error("Could not measure drag source/target");

    // Belt-and-suspenders: bounding boxes stay numerically valid even when
    // an element is scroll-clipped out of sight, so a stale-coordinate bug
    // wouldn't necessarily show up as a missing element — it'd show up as
    // a silently wrong drag. Fail loudly instead if either point actually
    // falls outside the viewport we're about to click in.
    const viewport = page.viewportSize();
    if (viewport) {
      const inViewport = (box: { x: number; width: number }) =>
        box.x >= 0 && box.x + box.width <= viewport.width;
      if (!inViewport(cardBox) || !inViewport(targetBox)) {
        throw new Error(
          `Drag source/target aren't both within the scrolled viewport ` +
            `(card x=${cardBox.x}, target x=${targetBox.x}, viewport width=${viewport.width})`,
        );
      }
    }

    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + Math.min(targetBox.height / 2, 150);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    try {
      // dnd-kit's PointerSensor requires movement past a 6px activation
      // distance before it registers a drag — a single jump from down() to
      // up() never crosses that threshold, so step across in increments.
      await page.mouse.move(endX, endY, { steps: 10 });
    } finally {
      // Exactly one up() for the one down() above, on every path. A gesture
      // abandoned mid-move must not leave the button held: the next
      // attempt's down() would then be a no-op and every retry would fail
      // for a reason that has nothing to do with what is being tested.
      await page.mouse.up();
    }

    // The verdict, and the only thing this function decides. Short on
    // purpose: the optimistic re-render is immediate when the activation
    // registered at all, so a slow answer here is a missed activation, and
    // the budget is better spent on another attempt than on waiting.
    return await landed
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true, () => false);
  }

  // Drags the card from column `fromIndex` to column `toIndex` and proves
  // the move reached the database (not just the optimistic UI) via reload.
  async function dragTo(fromIndex: number, toIndex: number) {
    const fromColumn = columns.nth(fromIndex);
    const toColumn = columns.nth(toIndex);
    const draggedCard = fromColumn.locator(`[data-testid="${cardId}"]`);
    const landed = toColumn.locator(`[data-testid="${cardId}"]`);

    // handleDragEnd fires the move as a Server Action (a POST back to this
    // same route) inside a transition. Start listening before the drag so
    // we can't miss it, then actually wait for it to finish before we ever
    // reload — otherwise the reload can race the in-flight request and win,
    // which looks identical to "the server write never landed" but is
    // really just the test not having given it the chance to.
    // Match the BODY too, not just method+URL: since the Phase-2 shell, the
    // sidebar's own server-action POST (getShellSnapshot)
    // also hits this route's URL on every navigation and can resolve this
    // wait in place of the move. Only the move's body carries the
    // opportunity id — the BARE id, not the "opp-"-prefixed testid
    // (data-testid is `opp-${opp.id}`; the action is called with opp.id).
    //
    // Armed ONCE, outside the retry loop: a missed activation fires no POST
    // at all, so re-arming per attempt would leave abandoned waits behind,
    // and the attempt that does register is the one this resolves on.
    const bareOppId = cardId!.replace(/^opp-/, "");
    const movePosted = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().includes("/pipeline") &&
        (res.request().postData() ?? "").includes(bareOppId),
    );
    // Attach a handler now so that if every attempt below misses and this
    // wait is abandoned, its eventual rejection (on page close) is already
    // handled rather than surfacing as an unhandled rejection that fails an
    // unrelated test later in the run. `await movePosted` below still gets
    // the real value — this only registers a second handler.
    void movePosted.catch(() => {});

    let moved = false;
    for (let attempt = 1; attempt <= DRAG_ATTEMPTS && !moved; attempt++) {
      moved = await attemptDrag(toColumn, draggedCard, landed);
    }
    // Never softened into a skip or a pass: three honest gestures that all
    // failed to move the card is a real failure of the thing under test.
    expect(
      moved,
      `the card never landed in column ${toIndex} after ${DRAG_ATTEMPTS} drag attempts`,
    ).toBeTruthy();

    const moveResponse = await movePosted;
    expect(moveResponse.ok()).toBeTruthy();

    // The board renders via useOptimistic, so the card can appear to have
    // moved even if the server write never landed. Only a reload proves the
    // move actually persisted to the database — and now that we've awaited
    // the mutation's own response above, the reload can't race ahead of it.
    await page.reload();
    await expect(landed).toBeVisible();
  }

  const sourceIndex = await findColumnIndex();
  // Always drag to a column *adjacent* to the source. Columns are a fixed
  // 288px wide and the board only shows a handful at a time, so a mouse-
  // coordinate drag needs source and target simultaneously on screen —
  // adjacent columns guarantee that regardless of where the board is
  // currently scrolled. Direction just needs to differ from the source, so
  // walk toward whichever neighbor exists.
  const targetIndex = sourceIndex === columnCount - 1 ? sourceIndex - 1 : sourceIndex + 1;

  await dragTo(sourceIndex, targetIndex);
  // Drag it straight back. This leaves the board (and the database) in
  // exactly the state the test found them in, which is what makes the test
  // safe to run repeatedly — earlier versions of this spec permanently
  // walked the card one column further right on every run until it drifted
  // off-screen entirely.
  await dragTo(targetIndex, sourceIndex);
});
