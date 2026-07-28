import { test, expect } from "@playwright/test";

test("dragging an opportunity persists after reload", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  // Target the company card by its own test id rather than a broad
  // `href*="/contacts"` substring match — see contacts.spec.ts for why that
  // locator is ambiguous.
  await page.locator('[data-testid^="account-"]').first().click();
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

  // Drags the card from column `fromIndex` to column `toIndex` and proves
  // the move reached the database (not just the optimistic UI) via reload.
  async function dragTo(fromIndex: number, toIndex: number) {
    const fromColumn = columns.nth(fromIndex);
    const toColumn = columns.nth(toIndex);
    const draggedCard = fromColumn.locator(`[data-testid="${cardId}"]`);

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
    await expect(draggedCard).toBeVisible();

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

    // handleDragEnd fires the move as a Server Action (a POST back to this
    // same route) inside a transition. Start listening before the drag so
    // we can't miss it, then actually wait for it to finish before we ever
    // reload — otherwise the reload can race the in-flight request and win,
    // which looks identical to "the server write never landed" but is
    // really just the test not having given it the chance to.
    const movePosted = page.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/pipeline"),
    );

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // dnd-kit's PointerSensor requires movement past a 6px activation
    // distance before it registers a drag — a single jump from down() to
    // up() never crosses that threshold, so step across in increments.
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    await expect(toColumn.locator(`[data-testid="${cardId}"]`)).toBeVisible();

    const moveResponse = await movePosted;
    expect(moveResponse.ok()).toBeTruthy();

    // The board renders via useOptimistic, so the card can appear to have
    // moved even if the server write never landed. Only a reload proves the
    // move actually persisted to the database — and now that we've awaited
    // the mutation's own response above, the reload can't race ahead of it.
    await page.reload();
    await expect(toColumn.locator(`[data-testid="${cardId}"]`)).toBeVisible();
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
