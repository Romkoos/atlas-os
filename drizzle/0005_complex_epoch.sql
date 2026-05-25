CREATE TABLE `benchmark_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`ts` integer NOT NULL,
	`task_id` text NOT NULL,
	`rep` integer NOT NULL,
	`infra_hash` text NOT NULL,
	`infra_snapshot` text NOT NULL,
	`repo_commit` text NOT NULL,
	`model` text NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`num_turns` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`success` integer NOT NULL,
	`fail_reason` text,
	`transcript_path` text
);
--> statement-breakpoint
CREATE INDEX `idx_bench_task` ON `benchmark_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_bench_infra` ON `benchmark_runs` (`infra_hash`);--> statement-breakpoint
CREATE INDEX `idx_bench_batch` ON `benchmark_runs` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_bench_ts` ON `benchmark_runs` (`ts`);