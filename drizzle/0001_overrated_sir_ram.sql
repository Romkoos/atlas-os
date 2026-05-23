CREATE TABLE `agent_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`end_reason` text,
	`score` integer,
	`summary` text,
	`total_tokens_in` integer DEFAULT 0 NOT NULL,
	`total_tokens_out` integer DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`avg_complexity` real
);
--> statement-breakpoint
CREATE TABLE `agent_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`project_path` text NOT NULL,
	`turn_index` integer NOT NULL,
	`ts` integer NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`tools_used` text NOT NULL,
	`skills_used` text NOT NULL,
	`complexity_proxy` real
);
--> statement-breakpoint
CREATE TABLE `ecosystem_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`target` text,
	`source` text,
	`diff` text,
	`note` text
);
