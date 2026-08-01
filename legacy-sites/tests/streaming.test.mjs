import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const siteRoot = new URL("../", import.meta.url);
const repositoryRoot = new URL("../../", import.meta.url);

test("Sites backend forwards StepFun SSE as browser-friendly NDJSON", async () => {
  const source = await readFile(new URL("lib/chat.ts", siteRoot), "utf8");
  const bundle = await readFile(new URL("dist/server/index.js", siteRoot), "utf8");

  for (const content of [source, bundle]) {
    assert.match(content, /application\/x-ndjson/);
    assert.match(content, /streamModelResponse/);
    assert.match(content, /MODEL_STREAM_ERROR/);
    assert.match(content, /\[DONE\]/);
  }
  assert.match(source, /stream:\s*wantsStream/);
  assert.match(source, /delta\?\.content/);
});

test("frontend renders streamed deltas as they arrive", async () => {
  const app = await readFile(
    new URL("frontend/src/App.jsx", repositoryRoot),
    "utf8",
  );
  const styles = await readFile(
    new URL("frontend/src/styles.css", repositoryRoot),
    "utf8",
  );

  assert.match(app, /streamChatRequest/);
  assert.match(app, /response\.body\.getReader\(\)/);
  assert.match(app, /event\.type === "delta"/);
  assert.match(app, /generatedText \+= event\.delta/);
  assert.match(app, /streaming-cursor/);
  assert.match(styles, /@keyframes stream-cursor/);
});
