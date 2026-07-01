CREATE TABLE `roadmap_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_roadmap_category` ON `roadmap_items` (`category`);--> statement-breakpoint
CREATE INDEX `idx_roadmap_status` ON `roadmap_items` (`status`);