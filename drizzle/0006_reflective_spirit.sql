CREATE TABLE `benchmark_analysis` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`model` text NOT NULL,
	`infra_hash` text NOT NULL,
	`baseline_infra_hash` text,
	`summary` text,
	`data_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bench_analysis_created` ON `benchmark_analysis` (`created_at`);