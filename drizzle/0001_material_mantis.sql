CREATE TABLE `chat_rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
