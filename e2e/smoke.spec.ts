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

test("offers no Google button unless the Worker has the credentials", async ({ page }) => {
	// The sign-in overlay, not a /login route: there isn't one.
	await page.goto("/");
	await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
	// A button that cannot work must not be shown: the browser asks the server
	// (GET /api/ → googleAuth), which is false without GOOGLE_CLIENT_ID/SECRET.
	await expect(page.getByRole("button", { name: "Continue with Google" })).toBeHidden();
});

test("unknown URLs show the 404 page", async ({ page }) => {
	await page.goto("/definitely-not-a-page");
	await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
});
