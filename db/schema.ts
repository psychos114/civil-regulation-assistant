import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
