import { expect, type Page } from "@playwright/test";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} for acceptance tests.`);
  }
  return value;
}

export function userA() {
  return {
    email: required("E2E_USER_A_EMAIL"),
    password: required("E2E_USER_A_PASSWORD")
  };
}

export function userB() {
  return {
    email: required("E2E_USER_B_EMAIL"),
    password: required("E2E_USER_B_PASSWORD")
  };
}

export function bookingContact() {
  const account = userA();
  return {
    name: process.env.E2E_BOOKING_NAME ?? "SAFI Acceptance User",
    email: process.env.E2E_BOOKING_EMAIL ?? account.email
  };
}

export async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Assistant + Checklist + Booking" })).toBeVisible({
    timeout: 60_000
  });
  await expect(page.getByRole("heading", { name: "Interactive checklist" })).toBeVisible({
    timeout: 120_000
  });
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Meeting follow-up pilot" })).toBeVisible({
    timeout: 30_000
  });
}

export async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (candidate) => candidate.startsWith("sb-") && candidate.endsWith("-auth-token")
    );
    if (!key) {
      throw new Error("Supabase session not found in localStorage.");
    }
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as {
      access_token?: string;
      currentSession?: { access_token?: string };
    };
    const token = parsed.access_token ?? parsed.currentSession?.access_token;
    if (!token) {
      throw new Error("Supabase access token missing from stored session.");
    }
    return token;
  });
}

export function uniqueLabel(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
