CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`code` text PRIMARY KEY NOT NULL,
	`base` text NOT NULL,
	`rate` real NOT NULL,
	`as_of` text NOT NULL
);
