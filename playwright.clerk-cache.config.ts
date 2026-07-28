import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

function requireLocalEnv(name: string) {
  const value = process.env[name];
  if (!value || value === "replace_me" || value.includes("replace-me")) {
    throw new Error(`${name} is required for the Clerk cache-isolation smoke`);
  }
  return value;
}

const port = Number(process.env.PAPERDECK_CLERK_CACHE_PORT ?? 3101);
const baseURL = `http://localhost:${port}`;

process.env.CLERK_PUBLISHABLE_KEY = requireLocalEnv(
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
);
requireLocalEnv("CLERK_SECRET_KEY");
requireLocalEnv("PAPERDECK_RLS_USER_A_EMAIL");
requireLocalEnv("PAPERDECK_RLS_USER_B_EMAIL");
requireLocalEnv("NEXT_PUBLIC_SUPABASE_URL");
requireLocalEnv("SUPABASE_SERVICE_ROLE_KEY");
process.env.NEXT_PUBLIC_PAPERDECK_DEV_AUTH = "false";
process.env.PAPERDECK_E2E_DEV_AUTH = "false";
process.env.PAPERDECK_CLERK_CACHE_SMOKE = "true";

export default defineConfig({
  testDir: "./tests/e2e-live",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: {
    command: `npm run dev -- --hostname localhost --port ${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/favicon.ico`,
  },
  projects: [
    {
      name: "clerk-setup",
      testMatch: /clerk-cache\.setup\.ts/,
    },
    {
      name: "shared-device-cache",
      testMatch: /shared-device-cache\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["clerk-setup"],
    },
  ],
});
