CREATE TABLE `regulations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`code` text NOT NULL,
	`release_date` text NOT NULL,
	`content` text NOT NULL,
	`version` text NOT NULL,
	`is_new` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_regulations_code` ON `regulations` (`code`);