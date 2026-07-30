import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const chunksPath = resolve(root, "rag_import", "chunks.jsonl");
const drizzleDirectory = resolve(root, "drizzle");
const startMarker = "-- RAG SEED START";
const endMarker = "-- RAG SEED END";
const batchSize = 10;

function sqlString(value) {
  return `'${String(value ?? "")
    .replaceAll("\0", "")
    .replaceAll("'", "''")}'`;
}

function sqlInteger(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Invalid page value: ${value}`);
  }
  return String(number);
}

function validateChunk(chunk, lineNumber) {
  const required = [
    "chunk_id",
    "doc_id",
    "company",
    "title",
    "source_url",
    "file_format",
    "content",
  ];
  for (const field of required) {
    if (typeof chunk[field] !== "string" || !chunk[field].trim()) {
      throw new Error(`Line ${lineNumber}: missing ${field}`);
    }
  }
  if (!/^https:\/\//i.test(chunk.source_url)) {
    throw new Error(`Line ${lineNumber}: source_url must use HTTPS`);
  }
}

const raw = await readFile(chunksPath, "utf8");
const chunks = raw
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    const chunk = JSON.parse(line);
    validateChunk(chunk, index + 1);
    return chunk;
  });

if (!chunks.length) {
  throw new Error("No RAG chunks found");
}

const migrationFiles = (await readdir(drizzleDirectory))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort()
  .reverse();

let migrationPath;
let migrationSql;
for (const name of migrationFiles) {
  const candidatePath = resolve(drizzleDirectory, name);
  const candidateSql = await readFile(candidatePath, "utf8");
  if (candidateSql.includes("CREATE TABLE `rag_chunks`")) {
    migrationPath = candidatePath;
    migrationSql = candidateSql;
    break;
  }
}

if (!migrationPath || migrationSql === undefined) {
  throw new Error(
    "No rag_chunks migration found. Run npm run db:generate first.",
  );
}

const markerPattern = new RegExp(
  `\\n?${startMarker}[\\s\\S]*?${endMarker}\\n?`,
  "m",
);
const baseMigration = migrationSql.replace(markerPattern, "").trimEnd();
const statements = [];

for (let index = 0; index < chunks.length; index += batchSize) {
  const values = chunks.slice(index, index + batchSize).map((chunk) => {
    return `(${[
      sqlString(chunk.chunk_id),
      sqlString(chunk.doc_id),
      sqlString(chunk.company),
      sqlString(chunk.stock_code),
      sqlString(chunk.title),
      sqlString(chunk.document_type),
      sqlString(chunk.report_year),
      sqlString(chunk.source_url),
      sqlString(chunk.file_format),
      sqlInteger(chunk.page),
      sqlString(chunk.content),
    ].join(", ")})`;
  });

  statements.push(
    `INSERT OR REPLACE INTO \`rag_chunks\` (` +
      "`chunk_id`, `doc_id`, `company`, `stock_code`, `title`, " +
      "`document_type`, `report_year`, `source_url`, `file_format`, " +
      "`page`, `content`) VALUES\n" +
      values.join(",\n") +
      ";",
  );
}

const seededMigration = `${baseMigration}
--> statement-breakpoint
${startMarker}
${statements.join("\n--> statement-breakpoint\n")}
${endMarker}
`;

await writeFile(migrationPath, seededMigration, "utf8");
console.log(
  `Added ${chunks.length} RAG chunks to ${migrationPath.split(/[\\/]/).at(-1)}`,
);
