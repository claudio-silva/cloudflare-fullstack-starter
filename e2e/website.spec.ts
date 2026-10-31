import { expect, test } from "@playwright/test";

// The product website (docs/WEBSITE.md), when the project has one. The
// Playwright config starts its dev server and publishes its address; without a
// website.config.ts there is no server and these tests are skipped.
const websiteUrl = process.env.WEBSITE_BASE_URL;

test.describe("product website", () => {
	test.skip(!websiteUrl, "this project has no product website (npm run setup:website)");

	test("carries the chosen theme into the app, which then keeps it", async ({ page }) => {
		await page.goto(websiteUrl!);

		// The site itself follows the choice.
		await page.getByRole("button", { name: "Dark theme" }).click();
		await expect(page.locator("html")).toHaveClass(/dark/);

		// "Open app" leaves for the app carrying ?theme=dark — the two are
		// different origins in production, so the URL is the only way across.
		const openApp = page.getByRole("link", { name: "Open app" }).first();
		await expect(openApp).toHaveAttribute("href", /theme=dark/);
		await openApp.click();

		// The app opens dark (sign-in, since nobody is signed in) …
		await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
		await expect(page.locator("html")).toHaveClass(/dark/);

		// … and stays dark on the next page, from its own storage: the theme
		// parameter is consumed and taken out of the URL.
		expect(new URL(page.url()).searchParams.get("theme")).toBeNull();
		await page.getByRole("button", { name: /sign up/i }).click();
		await expect(page.locator("html")).toHaveClass(/dark/);
	});

	test("the maintenance page stands on its own", async ({ page }) => {
		const response = await page.goto(`${websiteUrl}/maintenance.html`);
		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { name: "We are back shortly" })).toBeVisible();
	});
});
