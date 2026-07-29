import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build includes the regulation assistant frontend", async () => {
  const html = await readFile(new URL("dist/client/index.html", root), "utf8");
  assert.match(html, /土木工程智能规范助手/);
  assert.match(html, /版本 v0\.1/);
  assert.match(html, /const API_BASE[\s\S]*['"]\/api['"]/);
  assert.match(html, /regulations\/check-update/);
  assert.match(html, /regulations\/download/);
  assert.match(html, /regulations\/list/);
  assert.match(html, /regulations\/\$\{regulationId\}/);
  assert.match(html, /\$\{API_BASE\}\/chat/);
  assert.doesNotMatch(html, /STEPFUN_API_KEY/);
  assert.doesNotMatch(html, /所有数据仅存储在本地设备/);
});

test("build includes D1 configuration and migrations", async () => {
  const [hosting, regulationsMigration, rateLimitMigration] = await Promise.all([
    readFile(new URL("dist/.openai/hosting.json", root), "utf8"),
    readFile(
      new URL("dist/.openai/drizzle/0000_worthless_black_tom.sql", root),
      "utf8",
    ),
    readFile(
      new URL("dist/.openai/drizzle/0001_material_mantis.sql", root),
      "utf8",
    ),
  ]);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(regulationsMigration, /CREATE TABLE `regulations`/);
  assert.match(
    regulationsMigration,
    /CREATE UNIQUE INDEX `idx_regulations_code`/,
  );
  assert.match(rateLimitMigration, /CREATE TABLE `chat_rate_limits`/);
});

test("server bundle keeps the StepFun key on the server", async () => {
  const serverBundle = await readFile(
    new URL("dist/server/index.js", root),
    "utf8",
  );
  assert.match(serverBundle, /STEPFUN_API_KEY/);
  assert.match(serverBundle, /step-3\.7-flash/);
  assert.match(serverBundle, /chat\/completions/);
});
