PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_roadmap_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`claude_prompt` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_roadmap_items`("id", "title", "description", "category", "status", "priority", "claude_prompt", "position", "created_at", "updated_at") SELECT "id", "title", "description", "category", "status", "priority", "claude_prompt", "position", "created_at", "updated_at" FROM `roadmap_items`;--> statement-breakpoint
DROP TABLE `roadmap_items`;--> statement-breakpoint
ALTER TABLE `__new_roadmap_items` RENAME TO `roadmap_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_roadmap_category` ON `roadmap_items` (`category`);--> statement-breakpoint
CREATE INDEX `idx_roadmap_status` ON `roadmap_items` (`status`);