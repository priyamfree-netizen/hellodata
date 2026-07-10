import { test, expect } from "@playwright/test";

const EMAIL = process.env.TEST_EMAIL ?? "test@example.com";
const PASSWORD = process.env.TEST_PASSWORD ?? "testpassword123";

test.describe("Smoke: auth + core flow", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("redirect to login when unauthenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signup page loads", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: /sign up|create account/i })).toBeVisible();
  });

  test("full sign-in → dashboard → upload → sign-out", async ({ page }) => {
    // Sign in
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Should land on dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page.getByText(/overview/i)).toBeVisible();

    // Navigate to upload
    await page.getByRole("link", { name: /upload/i }).click();
    await expect(page).toHaveURL(/\/upload/);
    await expect(page.getByText(/upload|drag/i)).toBeVisible();

    // Navigate to output
    await page.getByRole("link", { name: /datasets/i }).click();
    await expect(page).toHaveURL(/\/output/);

    // Sign out
    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});
