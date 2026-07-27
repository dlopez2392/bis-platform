import { test, expect } from "@playwright/test";

test("dragging an opportunity persists after reload", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.locator('a[href*="/contacts"]').first().click();
  await page.getByRole("link", { name: "Opportunities" }).click();
  await expect(page).toHaveURL(/\/pipeline$/);

  const columns = page.locator("div.w-72");
  await expect(columns.first()).toBeVisible();
  const columnCount = await columns.count();

  const card = page.locator('[data-testid^="opp-"]').first();
  await expect(card).toBeVisible();
  const cardId = await card.getAttribute("data-testid");

  // Find which column currently holds the card so we always drag to a
  // *different* column — dropping back into the source column is a no-op
  // in PipelineBoard's handleDragEnd and would prove nothing.
  let sourceIndex = -1;
  for (let i = 0; i < columnCount; i++) {
    if (await columns.nth(i).locator(`[data-testid="${cardId}"]`).count()) {
      sourceIndex = i;
      break;
    }
  }
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  const targetIndex = (sourceIndex + 1) % columnCount;
  const targetColumn = columns.nth(targetIndex);

  const cardBox = await card.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!cardBox || !targetBox) throw new Error("Could not measure drag source/target");

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + Math.min(targetBox.height / 2, 150);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // dnd-kit's PointerSensor requires movement past a 6px activation
  // distance before it registers a drag — a single jump from down() to
  // up() never crosses that threshold, so step across in increments.
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  await expect(targetColumn.locator(`[data-testid="${cardId}"]`)).toBeVisible();

  // The board renders via useOptimistic, so the card can appear to have
  // moved even if the server write never landed. Only a reload proves the
  // move actually persisted to the database.
  await page.reload();
  await expect(targetColumn.locator(`[data-testid="${cardId}"]`)).toBeVisible();
});
