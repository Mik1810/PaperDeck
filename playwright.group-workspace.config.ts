import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PAPERDECK_GROUP_UI_PORT ?? 3210);
const mode = process.env.PAPERDECK_GROUP_UI_MODE ?? "owner";
const ownerId = process.env.PAPERDECK_DEV_OWNER_ID ?? "local-group-owner";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the isolated group workspace test");
}

export default defineConfig({
  testDir: "./tests/e2e-local",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...(mode === "mobile" ? devices["Pixel 5"] : devices["Desktop Chrome"]),
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env: {
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_MAX_CONNECTIONS: "3",
      NEXT_PUBLIC_PAPERDECK_DEV_AUTH: "true",
      PAPERDECK_DEV_OWNER_ID: ownerId,
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/feed",
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/onboarding",
      TMPDIR: "/tmp",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}/favicon.ico`,
  },
  projects: [{ name: mode }],
});
