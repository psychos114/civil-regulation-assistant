import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build includes the regulation assistant frontend", async () => {
  const html = await readFile(new URL("dist/client/index.html", root), "utf8");
  const assetDirectory = new URL("dist/client/assets/", root);
  const assetNames = await readdir(assetDirectory);
  const scripts = await Promise.all(
    assetNames
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFile(new URL(name, assetDirectory), "utf8")),
  );
  const browserBundle = scripts.join("\n");

  assert.match(html, /土木工程智能规范助手/);
  assert.match(browserBundle, /regulations\/check-update/);
  assert.match(browserBundle, /regulations\/download/);
  assert.match(browserBundle, /regulations\/list/);
  assert.match(browserBundle, /sourceDetails/);
  assert.match(browserBundle, /查看原文/);
  assert.match(browserBundle, /FAISS/);
  assert.doesNotMatch(html + browserBundle, /STEPFUN_API_KEY/);
  assert.doesNotMatch(html + browserBundle, /Pinecone/);
});

test("build includes D1 configuration and migrations", async () => {
  const [
    hosting,
    regulationsMigration,
    rateLimitMigration,
    vectorMigration,
  ] = await Promise.all([
    readFile(new URL("dist/.openai/hosting.json", root), "utf8"),
    readFile(
      new URL("dist/.openai/drizzle/0000_worthless_black_tom.sql", root),
      "utf8",
    ),
    readFile(
      new URL("dist/.openai/drizzle/0001_material_mantis.sql", root),
      "utf8",
    ),
    readFile(
      new URL("dist/.openai/drizzle/0003_tense_thena.sql", root),
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
  assert.match(vectorMigration, /CREATE TABLE `rag_vector_store`/);
  assert.match(vectorMigration, /CREATE TABLE `rag_vector_documents`/);
});

test("server bundle keeps the model key server-side and exposes FAISS compatibility status", async () => {
  const serverBundle = await readFile(
    new URL("dist/server/index.js", root),
    "utf8",
  );
  assert.match(serverBundle, /STEPFUN_API_KEY/);
  assert.match(serverBundle, /step-3\.7-flash/);
  assert.match(serverBundle, /chat\/completions/);
  assert.match(serverBundle, /本次回答已使用检索到的知识库资料/);
  assert.doesNotMatch(serverBundle, /civil_regulation_answer/);
  assert.match(serverBundle, /rag_chunks/);
  assert.match(serverBundle, /sourceDetails/);
  assert.match(serverBundle, /api\/rag\/status/);
  assert.match(serverBundle, /api\/rag\/vector-store/);
  assert.match(serverBundle, /FAISS/);
  assert.match(serverBundle, /FAISS_RUNTIME_UNAVAILABLE/);
  assert.match(serverBundle, /requires_fastapi_runtime/);
  assert.match(serverBundle, /application\/x-ndjson/);
  assert.doesNotMatch(serverBundle, /PINECONE_API_KEY/);
  assert.doesNotMatch(serverBundle, /Pinecone/);
});

test("RAG migration contains the company knowledge base", async () => {
  const drizzleDirectory = new URL("dist/.openai/drizzle/", root);
  const migrationNames = await readdir(drizzleDirectory);
  const migrationContents = await Promise.all(
    migrationNames
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFile(new URL(name, drizzleDirectory), "utf8")),
  );
  const ragMigration = migrationContents.find((content) =>
    content.includes("CREATE TABLE `rag_chunks`"),
  );

  assert.ok(ragMigration, "missing rag_chunks migration");
  assert.match(ragMigration, /CREATE INDEX `idx_rag_chunks_doc_id`/);
  assert.match(ragMigration, /RAG SEED START/);
  assert.match(ragMigration, /cscec_2025_annual_report/);
  assert.match(ragMigration, /中国建筑股份有限公司/);
});
