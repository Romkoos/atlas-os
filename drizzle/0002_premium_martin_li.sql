CREATE INDEX `idx_sessions_project` ON `agent_sessions` (`project_path`);--> statement-breakpoint
CREATE INDEX `idx_sessions_started` ON `agent_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_turns_session` ON `agent_turns` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_turns_project` ON `agent_turns` (`project_path`);--> statement-breakpoint
CREATE INDEX `idx_turns_ts` ON `agent_turns` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_eco_ts` ON `ecosystem_changes` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_eco_type` ON `ecosystem_changes` (`type`);