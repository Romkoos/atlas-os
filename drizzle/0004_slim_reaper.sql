CREATE TABLE `kpi_baseline` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`method` text NOT NULL,
	`params` text NOT NULL,
	`session_count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_kpi_baseline_scope` ON `kpi_baseline` (`scope`);--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `difficulty` integer;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `difficulty_source` text;