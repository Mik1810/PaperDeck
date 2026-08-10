import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("administrative database consumers prefer the Session-pooler URL", () => {
  for (const file of [
    "drizzle.config.ts",
    "scripts/prune-notifications.ts",
    "scripts/prune-recommendation-impressions.ts",
  ]) {
    assert.match(
      source(file),
      /process\.env\.DATABASE_ADMIN_URL\s*\?\?\s*process\.env\.DATABASE_URL/,
      `${file} must prefer DATABASE_ADMIN_URL`,
    );
  }
});

test("example environment separates runtime and administrative poolers", () => {
  const example = source(".env.example");
  assert.match(example, /^DATABASE_URL=.*:6543\/postgres$/m);
  assert.match(example, /^DATABASE_ADMIN_URL=.*:5432\/postgres$/m);
  assert.match(example, /^DATABASE_MAX_CONNECTIONS=3$/m);
});
