ALTER TABLE `debtors` ADD `currency` text DEFAULT 'RUB' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `destination_amount` integer;