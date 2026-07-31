CREATE TABLE `rag_vector_documents` (
	`doc_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_url` text NOT NULL,
	`file_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`updated_at` text NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `rag_vector_store` (
	`id` integer PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'stepfun' NOT NULL,
	`vector_store_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_error` text
);
