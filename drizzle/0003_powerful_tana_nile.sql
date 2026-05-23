ALTER TABLE `agent_sessions` ADD `distinct_files` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `distinct_dirs` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `distinct_tools` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `distinct_skills` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `subagent_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_turns` ADD `files_touched` text DEFAULT '[]' NOT NULL;