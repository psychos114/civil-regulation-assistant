import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const regulations = sqliteTable(
  "regulations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    code: text("code").notNull(),
    releaseDate: text("release_date").notNull(),
    content: text("content").notNull(),
    version: text("version").notNull(),
    isNew: integer("is_new").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_regulations_code").on(table.code)],
);

export const chatRateLimits = sqliteTable("chat_rate_limits", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const ragChunks = sqliteTable(
  "rag_chunks",
  {
    chunkId: text("chunk_id").primaryKey(),
    docId: text("doc_id").notNull(),
    company: text("company").notNull(),
    stockCode: text("stock_code").notNull().default(""),
    title: text("title").notNull(),
    documentType: text("document_type").notNull().default(""),
    reportYear: text("report_year").notNull().default(""),
    sourceUrl: text("source_url").notNull(),
    fileFormat: text("file_format").notNull(),
    page: integer("page"),
    content: text("content").notNull(),
  },
  (table) => [
    index("idx_rag_chunks_doc_id").on(table.docId),
    index("idx_rag_chunks_title").on(table.title),
  ],
);
