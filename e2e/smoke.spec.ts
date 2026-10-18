import { expect, test } from "@playwright/test";

test("sign up and reach the protected home", async ({ page }) => {
	const email = `e2e-${Date.now()}@example.com`;
	const password = "E2e-password-123!";

	await page.goto("/signup");
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page.getByLabel("Confirm Password").fill(password);
	await page.getByRole("button", { name: "Create Account" }).click();

	await expect(page.getByText("Welcome to Your App")).toBeVisible();
});

test("unknown URLs show the 404 page", async ({ page }) => {
	await page.goto("/definitely-not-a-page");
	await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
});
