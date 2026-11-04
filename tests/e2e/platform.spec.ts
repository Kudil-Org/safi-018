import { expect, test } from "@playwright/test";
import { bookingContact, signIn, signOut, uniqueLabel, userA, userB } from "./helpers";

test.describe("SAFI platform acceptance", () => {
  test("E01/E02/E05: sign in, create checklist changes, and persist them", async ({ page }) => {
    const itemText = uniqueLabel("Persisted follow-up");

    await signIn(page, userA());

    await page.getByPlaceholder("Add a checklist item").fill(itemText);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(itemText)).toBeVisible({ timeout: 30_000 });

    await page.getByText(itemText).click();
    await expect(page.getByRole("checkbox", { name: itemText })).toBeChecked({ timeout: 30_000 });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Interactive checklist" })).toBeVisible({
      timeout: 120_000
    });
    await expect(page.getByText(itemText)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("checkbox", { name: itemText })).toBeChecked();

    await signOut(page);
    await signIn(page, userA());
    await expect(page.getByText(itemText)).toBeVisible({ timeout: 60_000 });
  });

  test("E03/E04: the real Windmill Assistant mutates the Artifact", async ({ page }) => {
    const itemText = uniqueLabel("Assistant follow-up");

    await signIn(page, userA());

    const composer = page.getByPlaceholder("Ask for a checklist change or a booking slot...");
    await composer.fill(
      `Call apply_checklist_change exactly once with op "add_item" and text "${itemText}". Do not add any other item. Reply with one short sentence.`
    );
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(itemText)).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText(/version \d+/).first()).toBeVisible();
  });

  test("E06: explicit approval creates and persists a real Calnode booking", async ({ page }) => {
    const contact = bookingContact();

    await signIn(page, userA());

    const confirmed = page.getByRole("heading", { name: "Confirmed" });
    if (await confirmed.isVisible().catch(() => false)) {
      await expect(page.getByText("Booking ID")).toBeVisible();
      return;
    }

    await expect(page.getByRole("radiogroup", { name: "Available booking slots" })).toBeVisible({
      timeout: 60_000
    });
    const slots = page.getByRole("radio");
    await expect(slots.first()).toBeVisible({ timeout: 30_000 });
    await slots.first().click();

    await page.getByLabel("Full name").fill(contact.name);
    await page.getByLabel("Email").fill(contact.email);
    await page.getByRole("button", { name: "Approve and book this slot" }).click();

    await expect(confirmed).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Booking ID")).toBeVisible();

    await page.reload();
    await expect(confirmed).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Booking ID")).toBeVisible();
  });

  test("E07: another account cannot see this account's Artifact", async ({ browser, page }) => {
    const privateText = uniqueLabel("Private follow-up");

    await signIn(page, userA());
    await page.getByPlaceholder("Add a checklist item").fill(privateText);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(privateText)).toBeVisible({ timeout: 30_000 });

    const second = await browser.newContext();
    const secondPage = await second.newPage();
    await signIn(secondPage, userB());

    await expect(secondPage.getByText(privateText)).toHaveCount(0);
    await expect(secondPage.getByRole("heading", { name: "Interactive checklist" })).toBeVisible();
    await second.close();
  });
});
