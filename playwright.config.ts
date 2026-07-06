import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const devAuth = process.env.PAPERDECK_E2E_DEV_AUTH ?? "true";
const devOwnerId = process.env.PAPERDECK_E2E_OWNER_ID ?? "playwright-user";

process.env.PAPERDECK_E2E_DEV_AUTH = devAuth;
process.env.PAPERDECK_DEV_OWNER_ID = devOwnerId;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env: {
      PAPERDECK_DEV_AUTH: devAuth,
      PAPERDECK_DEV_OWNER_ID: devOwnerId,
      NEXT_PUBLIC_CLERK_SIGN_IN_URL:
        process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in",
      NEXT_PUBLIC_CLERK_SIGN_UP_URL:
        process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up",
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL:
        process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ?? "/feed",
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL:
        process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ??
        "/onboarding",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: `${baseURL}/favicon.ico`,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    ...(process.env.CI
      ? []
      : [
          {
            name: "mobile-chrome",
            use: { ...devices["Pixel 5"] },
          },
        ]),
  ],
});
